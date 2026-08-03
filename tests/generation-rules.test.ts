import { describe, expect, it } from 'vitest'
import { findCta, findHeadline, normalizeHtml, replaceSlot } from '@/lib/generation/html'
import { variantKey } from '@/lib/generation/keys'
import { createRuleProvider, RULE_KEYS } from '@/lib/generation/rules'
import { hasVisibleContent, sanitizeGeneratedHtml } from '@/lib/generation/sanitize'

const HYPED = '<h1>Powerful analytics for busy teams</h1><a href="/signup">Learn more</a>'

function generate(html: string, count = 4) {
  return createRuleProvider().generate({ baselineHtml: html, count })
}

describe('html slots', () => {
  it('finds the first heading and its offsets', () => {
    const slot = findHeadline('<div><h1>Ship faster</h1><h2>Later</h2></div>')
    expect(slot).not.toBeNull()
    expect(slot!.text).toBe('Ship faster')
    expect(slot!.tag).toBe('h1')
  })

  it('falls back to h2 and then h3', () => {
    expect(findHeadline('<h2>Ship faster</h2>')!.tag).toBe('h2')
    expect(findHeadline('<h3>Ship faster</h3>')!.tag).toBe('h3')
  })

  it('declines headings that contain markup rather than mangling them', () => {
    expect(findHeadline('<h1>Ship <em>faster</em></h1>')).toBeNull()
  })

  it('ignores an empty heading', () => {
    expect(findHeadline('<h1>   </h1>')).toBeNull()
  })

  it('prefers a button over a link for the call to action', () => {
    expect(findCta('<a href="/x">Home</a><button>Sign up</button>')!.text).toBe('Sign up')
  })

  it('replaces slot text and keeps the surrounding whitespace', () => {
    const html = '<h1>\n  Ship faster\n</h1>'
    const slot = findHeadline(html)!
    expect(replaceSlot(html, slot, 'Ship on Friday')).toBe('<h1>\n  Ship on Friday\n</h1>')
  })

  it('normalises whitespace for comparison', () => {
    expect(normalizeHtml('<h1>  Ship\n faster </h1>')).toBe('<h1> Ship faster </h1>')
  })
})

describe('sanitizeGeneratedHtml', () => {
  it('drops scripts, event handlers, and javascript: urls', () => {
    const dirty =
      '<h1>Hi</h1><script>alert(1)</script><a href="javascript:alert(1)" onclick="x()">Go</a>'
    expect(sanitizeGeneratedHtml(dirty)).toBe('<h1>Hi</h1><a>Go</a>')
  })

  it('drops iframes, embeds, and stray head tags', () => {
    const dirty = '<meta charset="utf-8"><iframe src="/x"></iframe><h1>Hi</h1><embed src="/y">'
    expect(sanitizeGeneratedHtml(dirty)).toBe('<h1>Hi</h1>')
  })

  it('removes an unclosed script tag too', () => {
    expect(sanitizeGeneratedHtml('<h1>Hi</h1><script src="/x">')).toBe('<h1>Hi</h1>')
  })

  it('leaves ordinary markup, styles, and real links alone', () => {
    const clean = '<style>h1{color:red}</style><h1 class="hero">Hi</h1><a href="/signup">Go</a>'
    expect(sanitizeGeneratedHtml(clean)).toBe(clean)
  })

  it('knows when nothing visible survived', () => {
    expect(hasVisibleContent('<h1>Hi</h1>')).toBe(true)
    expect(hasVisibleContent('<div><span></span></div>')).toBe(false)
  })
})

describe('variantKey', () => {
  it('starts at b, since control is the first variant', () => {
    expect([0, 1, 2].map(variantKey)).toEqual(['b', 'c', 'd'])
  })

  it('numbers keys past z instead of doubling letters', () => {
    expect(variantKey(24)).toBe('z')
    expect(variantKey(25)).toBe('v27')
  })

  it('rejects a negative index', () => {
    expect(() => variantKey(-1)).toThrow(RangeError)
  })
})

describe('rule provider', () => {
  it('strips hype from the headline and sharpens the call to action', async () => {
    const variants = await generate(HYPED)
    const html = variants.map((v) => v.html)

    expect(html).toContain('<h1>Analytics for busy teams</h1><a href="/signup">Learn more</a>')
    expect(html).toContain(
      '<h1>Powerful analytics for busy teams</h1><a href="/signup">See how it works</a>',
    )
  })

  it('keys variants from b upward and explains each change', async () => {
    const variants = await generate(HYPED)
    expect(variants.map((v) => v.key)).toEqual(['b', 'c'])
    for (const variant of variants) {
      expect(variant.rationale.length).toBeGreaterThan(20)
    }
  })

  it('turns an imperative headline into a question', async () => {
    const variants = await generate('<h1>Ship faster without breaking things</h1>')
    expect(variants.map((v) => v.html)).toEqual([
      '<h1>Ready to ship faster without breaking things?</h1>',
    ])
  })

  it('leaves a headline that is already a question alone', async () => {
    expect(await generate('<h1>Ready to ship faster?</h1>')).toEqual([])
  })

  it('does not turn a noun-phrase headline into a question', async () => {
    const variants = await generate('<h1>Analytics for busy teams</h1>')
    expect(variants).toEqual([])
  })

  it('cuts a long headline at its first clause', async () => {
    const variants = await generate(
      '<h1>Analytics for busy teams, without the tag manager and the warehouse</h1>',
    )
    expect(variants.map((v) => v.html)).toEqual(['<h1>Analytics for busy teams</h1>'])
  })

  it('will not truncate a long headline that has no clause boundary', async () => {
    expect(
      await generate('<h1>Analytics for busy teams that already have too much software</h1>'),
    ).toEqual([])
  })

  it('preserves the href when it rewrites a link CTA', async () => {
    const variants = await generate('<a href="/signup?ref=hero">Sign up</a>')
    expect(variants[0].html).toBe('<a href="/signup?ref=hero">Get started</a>')
  })

  it('leaves a CTA it has no opinion about', async () => {
    expect(await generate('<button>Book my seat</button>')).toEqual([])
  })

  it('is deterministic', async () => {
    expect(await generate(HYPED)).toEqual(await generate(HYPED))
  })

  it('stops at the requested count', async () => {
    expect(await generate(HYPED, 1)).toHaveLength(1)
  })

  it('returns nothing for a page it cannot improve, rather than a copy of it', async () => {
    expect(await generate('<p>Just a paragraph.</p>')).toEqual([])
  })

  it('needs no API key', () => {
    const provider = createRuleProvider()
    expect(provider.needsApiKey).toBe(false)
    expect(provider.name).toBe('rules')
    expect(RULE_KEYS.length).toBeGreaterThan(0)
  })
})
