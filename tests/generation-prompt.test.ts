import { describe, expect, it } from 'vitest'
import { buildUserPrompt, parseGeneratedVariants, SYSTEM_PROMPT } from '@/lib/generation/prompt'
import { GenerationError } from '@/lib/generation/types'

describe('prompt', () => {
  it('tells the model not to invent facts and to return JSON', () => {
    expect(SYSTEM_PROMPT).toMatch(/Never invent facts/)
    expect(SYSTEM_PROMPT).toMatch(/JSON only/)
    expect(SYSTEM_PROMPT).toMatch(/No <script>/)
  })

  it('carries the page, the count, and the goal', () => {
    const prompt = buildUserPrompt({
      baselineHtml: '<h1>Ship faster</h1>',
      goal: 'start a free trial',
      count: 3,
    })
    expect(prompt).toContain('Produce 3 variants')
    expect(prompt).toContain('start a free trial')
    expect(prompt).toContain('<h1>Ship faster</h1>')
  })

  it('says the goal is unknown rather than leaving a blank line', () => {
    const prompt = buildUserPrompt({ baselineHtml: '<h1>Hi</h1>', count: 1 })
    expect(prompt).toContain('Produce 1 variant of the page')
    expect(prompt).toContain('infer it from the page')
  })
})

describe('parseGeneratedVariants', () => {
  const body = JSON.stringify({
    variants: [
      { rationale: 'Shorter headline.', html: '<h1>Ship</h1>' },
      { rationale: 'Direct CTA.', html: '<h1>Ship faster</h1><button>Start now</button>' },
    ],
  })

  it('parses the documented shape', () => {
    expect(parseGeneratedVariants(body)).toEqual([
      { rationale: 'Shorter headline.', html: '<h1>Ship</h1>' },
      { rationale: 'Direct CTA.', html: '<h1>Ship faster</h1><button>Start now</button>' },
    ])
  })

  it('tolerates markdown fences', () => {
    expect(parseGeneratedVariants('```json\n' + body + '\n```')).toHaveLength(2)
  })

  it('tolerates a sentence before the JSON', () => {
    expect(parseGeneratedVariants(`Here you go!\n${body}`)).toHaveLength(2)
  })

  it('accepts a bare array', () => {
    expect(parseGeneratedVariants('[{"html":"<h1>Ship</h1>"}]')).toEqual([
      { html: '<h1>Ship</h1>', rationale: 'No rationale given.' },
    ])
  })

  it('drops individually unusable items but keeps the good ones', () => {
    const mixed = '{"variants":[{"html":""},null,{"html":42},{"html":"<h1>Ship</h1>"}]}'
    expect(parseGeneratedVariants(mixed)).toHaveLength(1)
  })

  it('rejects an empty response', () => {
    expect(() => parseGeneratedVariants('   ')).toThrow(GenerationError)
  })

  it('rejects prose that is not JSON, quoting what came back', () => {
    expect(() => parseGeneratedVariants('I am sorry, I cannot do that.')).toThrow(
      /did not return JSON: I am sorry/,
    )
  })

  it('rejects JSON without a variants array', () => {
    expect(() => parseGeneratedVariants('{"result":"ok"}')).toThrow(/no "variants" array/)
  })

  it('rejects a response where every item is unusable', () => {
    expect(() => parseGeneratedVariants('{"variants":[{"html":""}]}')).toThrow(
      /no usable variants/,
    )
  })

  it('truncates a long response in the error message', () => {
    const long = 'x'.repeat(500)
    expect(() => parseGeneratedVariants(long)).toThrow(/…/)
  })
})
