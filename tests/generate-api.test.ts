import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET as providerRoute, POST as generateRoute } from '@/app/api/generate/route'
import {
  DEFAULT_VARIANT_COUNT,
  MAX_VARIANT_COUNT,
  generateVariants,
  resolveProvider,
  validateGenerationRequest,
} from '@/lib/generation'
import { GenerationError, NoVariantsError, type VariantProvider } from '@/lib/generation/types'
import { ValidationError } from '@/lib/experiments'

const HYPED = '<h1>Powerful analytics for busy teams</h1><a href="/signup">Learn more</a>'

function post(body: unknown): Request {
  return new Request('http://test/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function generate(body: unknown) {
  const res = await generateRoute(post(body))
  return { status: res.status, body: await res.json() }
}

/** A provider that returns exactly what a test hands it. */
function fakeProvider(variants: Array<{ html: string; rationale?: string }>): VariantProvider {
  return {
    name: 'fake',
    needsApiKey: false,
    async generate() {
      return variants.map((v, i) => ({
        key: `x${i}`,
        html: v.html,
        rationale: v.rationale ?? 'because',
      }))
    },
  }
}

describe('resolveProvider', () => {
  it('falls back to the offline rules when no key is set', () => {
    const provider = resolveProvider({})
    expect(provider.name).toBe('rules')
    expect(provider.needsApiKey).toBe(false)
  })

  it('uses the model when a key is present', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k' }).name).toBe('anthropic')
  })

  it('lets an explicit choice override a present key, which is how CI runs', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k', VARIANT_LAB_PROVIDER: 'rules' }).name).toBe(
      'rules',
    )
  })

  it('refuses to pretend when anthropic is asked for without a key', () => {
    expect(() => resolveProvider({ VARIANT_LAB_PROVIDER: 'anthropic' })).toThrow(
      /needs ANTHROPIC_API_KEY/,
    )
  })

  it('rejects an unknown provider name', () => {
    expect(() => resolveProvider({ VARIANT_LAB_PROVIDER: 'gpt' })).toThrow(GenerationError)
  })
})

describe('validateGenerationRequest', () => {
  it('defaults the count and leaves the goal null', () => {
    expect(validateGenerationRequest({ baselineHtml: '<h1>Hi</h1>' })).toEqual({
      baselineHtml: '<h1>Hi</h1>',
      goal: null,
      count: DEFAULT_VARIANT_COUNT,
    })
  })

  it('requires HTML', () => {
    expect(() => validateGenerationRequest({ baselineHtml: '   ' })).toThrow(ValidationError)
  })

  it('rejects HTML over the store’s cap', () => {
    expect(() => validateGenerationRequest({ baselineHtml: 'x'.repeat(600 * 1024) })).toThrow(
      /at most/,
    )
  })

  it('rejects a count outside 1..max', () => {
    for (const count of [0, MAX_VARIANT_COUNT + 1, 1.5, '2']) {
      expect(() => validateGenerationRequest({ baselineHtml: '<h1>Hi</h1>', count })).toThrow(
        ValidationError,
      )
    }
  })

  it('trims an empty goal down to null', () => {
    expect(validateGenerationRequest({ baselineHtml: '<h1>Hi</h1>', goal: '  ' }).goal).toBeNull()
  })
})

describe('generateVariants', () => {
  const request = { baselineHtml: HYPED, goal: null, count: 3 }

  it('sanitises whatever the provider returns', async () => {
    const result = await generateVariants(
      request,
      fakeProvider([{ html: '<h1>Hi</h1><script>steal()</script>' }]),
    )
    expect(result.variants[0].html).toBe('<h1>Hi</h1>')
  })

  it('drops drafts identical to the baseline', async () => {
    const result = await generateVariants(
      request,
      fakeProvider([{ html: HYPED }, { html: '<h1>Hi</h1>' }]),
    )
    expect(result.variants).toHaveLength(1)
    expect(result.variants[0].key).toBe('b')
  })

  it('drops duplicate drafts and re-keys what is left contiguously', async () => {
    const result = await generateVariants(
      request,
      fakeProvider([{ html: '<h1>Hi</h1>' }, { html: '<h1>Hi</h1> ' }, { html: '<h1>Yo</h1>' }]),
    )
    expect(result.variants.map((v) => v.key)).toEqual(['b', 'c'])
  })

  it('drops a draft with no visible content', async () => {
    const result = await generateVariants(
      request,
      fakeProvider([{ html: '<script>x()</script>' }, { html: '<h1>Hi</h1>' }]),
    )
    expect(result.variants).toHaveLength(1)
  })

  it('flags a short result rather than padding it', async () => {
    const result = await generateVariants(request, fakeProvider([{ html: '<h1>Hi</h1>' }]))
    expect(result.short).toBe(true)
  })

  it('never returns more than were asked for', async () => {
    const result = await generateVariants(
      { ...request, count: 1 },
      fakeProvider([{ html: '<h1>Hi</h1>' }, { html: '<h1>Yo</h1>' }]),
    )
    expect(result.variants).toHaveLength(1)
    expect(result.short).toBe(false)
  })

  it('says so when nothing usable came back', async () => {
    await expect(generateVariants(request, fakeProvider([{ html: HYPED }]))).rejects.toThrow(
      NoVariantsError,
    )
  })

  it('names the provider that produced the drafts', async () => {
    const result = await generateVariants(request, fakeProvider([{ html: '<h1>Hi</h1>' }]))
    expect(result.provider).toBe('fake')
  })
})

describe('POST /api/generate', () => {
  const saved = {
    provider: process.env.VARIANT_LAB_PROVIDER,
    key: process.env.ANTHROPIC_API_KEY,
  }

  beforeEach(() => {
    // Pin the offline provider so the suite never depends on a key, or spends one.
    process.env.VARIANT_LAB_PROVIDER = 'rules'
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (saved.provider === undefined) delete process.env.VARIANT_LAB_PROVIDER
    else process.env.VARIANT_LAB_PROVIDER = saved.provider
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = saved.key
  })

  it('returns drafts with keys, HTML, and rationales', async () => {
    const { status, body } = await generate({ baselineHtml: HYPED, count: 2 })

    expect(status).toBe(200)
    expect(body.provider).toBe('rules')
    expect(body.variants.map((v: { key: string }) => v.key)).toEqual(['b', 'c'])
    expect(body.variants[0].html).toContain('<h1>Analytics for busy teams</h1>')
    expect(body.variants[0].rationale).toMatch(/intensifiers/)
  })

  it('persists nothing — the drafts are for a human to approve', async () => {
    await generate({ baselineHtml: HYPED })
    const { GET: listExperiments } = await import('@/app/api/experiments/route')
    const listed = await (await listExperiments()).json()
    expect(listed.experiments).toEqual([])
  })

  it('rejects a request with no HTML', async () => {
    const { status, body } = await generate({ count: 2 })
    expect(status).toBe(400)
    expect(body.error).toMatch(/baselineHtml is required/)
  })

  it('rejects a body that is not JSON', async () => {
    const { status } = await generate('not json')
    expect(status).toBe(400)
  })

  it('rejects an out-of-range count', async () => {
    expect((await generate({ baselineHtml: HYPED, count: 99 })).status).toBe(400)
  })

  it('returns 422 when the page has nothing the rules can change', async () => {
    const { status, body } = await generate({ baselineHtml: '<p>Just a paragraph.</p>' })
    expect(status).toBe(422)
    expect(body.error).toMatch(/nothing that differs/)
  })

  it('returns 502 when the configured provider cannot run', async () => {
    process.env.VARIANT_LAB_PROVIDER = 'anthropic'
    const { status, body } = await generate({ baselineHtml: HYPED })
    expect(status).toBe(502)
    expect(body.error).toMatch(/ANTHROPIC_API_KEY/)
  })

  it('reports which provider is configured', async () => {
    const res = await providerRoute()
    expect(await res.json()).toEqual({ provider: 'rules', needsApiKey: false })
  })
})
