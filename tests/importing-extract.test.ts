import { describe, expect, it } from 'vitest'
import { elementContents, extractPage, extractTitle, resolveUrls } from '@/lib/importing/extract'

const BASE = 'https://example.com/pricing'

describe('elementContents', () => {
  it('returns the inner markup of the first match', () => {
    expect(elementContents('<main><h1>Hi</h1></main>', 'main')).toBe('<h1>Hi</h1>')
  })

  it('walks past a nested element of the same tag', () => {
    // A non-greedy regex stops at the inner </article> and returns half a page.
    const html = '<article>outer<article>inner</article>tail</article>'
    expect(elementContents(html, 'article')).toBe('outer<article>inner</article>tail')
  })

  it('returns null when the element never closes', () => {
    expect(elementContents('<main><h1>Hi</h1>', 'main')).toBeNull()
  })

  it('returns null when there is no such element', () => {
    expect(elementContents('<div>x</div>', 'main')).toBeNull()
  })
})

describe('extractTitle', () => {
  it('prefers <title>', () => {
    expect(extractTitle('<title>Pricing — Acme</title><h1>Plans</h1>')).toBe('Pricing — Acme')
  })

  it('collapses whitespace and decodes entities', () => {
    expect(extractTitle('<title>\n  Acme &amp; Co\n</title>')).toBe('Acme & Co')
  })

  it('falls back to a heading when there is no title', () => {
    expect(extractTitle('<h1>Plans <em>and</em> pricing</h1>')).toBe('Plans and pricing')
  })

  it('is null when the page names itself nowhere', () => {
    expect(extractTitle('<p>words</p>')).toBeNull()
    expect(extractTitle('<title>   </title>')).toBeNull()
  })
})

describe('resolveUrls', () => {
  it('makes relative links absolute', () => {
    expect(resolveUrls('<a href="/signup">Go</a>', BASE)).toContain('href="https://example.com/signup"')
    expect(resolveUrls('<img src="hero.png">', BASE)).toContain(
      'src="https://example.com/hero.png"',
    )
  })

  it('leaves absolute, protocol-relative and fragment URLs alone', () => {
    const html =
      '<a href="https://other.test/x">a</a><a href="//cdn.test/y">b</a><a href="#faq">c</a>'
    expect(resolveUrls(html, BASE)).toBe(html)
  })

  it('leaves non-location schemes alone', () => {
    const html = '<a href="mailto:hi@example.com">mail</a><img src="data:image/gif;base64,AA">'
    expect(resolveUrls(html, BASE)).toBe(html)
  })

  it('handles single quotes and unquoted values', () => {
    expect(resolveUrls("<a href='/a'>x</a>", BASE)).toContain('href="https://example.com/a"')
    expect(resolveUrls('<a href=/b>x</a>', BASE)).toContain('href="https://example.com/b"')
  })

  it('resolves every candidate in a srcset', () => {
    const out = resolveUrls('<img srcset="a.png 1x, b.png 2x">', BASE)
    expect(out).toContain('https://example.com/a.png 1x')
    expect(out).toContain('https://example.com/b.png 2x')
  })
})

describe('extractPage', () => {
  const page = `
    <!doctype html>
    <html>
      <head>
        <title>Acme Pricing</title>
        <style>body { color: red }</style>
        <script>window.analytics = 1</script>
      </head>
      <body>
        <nav><a href="/about">About</a></nav>
        <main>
          <h1>Simple pricing</h1>
          <p>Start free, upgrade when it pays for itself.</p>
          <a href="/signup" onclick="track()">Start free</a>
          <img src="/hero.png">
        </main>
        <script src="/tracker.js"></script>
      </body>
    </html>
  `

  it('keeps the page title', () => {
    expect(extractPage(page, BASE).title).toBe('Acme Pricing')
  })

  it('narrows to <main> and drops the chrome around it', () => {
    const { html } = extractPage(page, BASE)
    expect(html).toContain('Simple pricing')
    expect(html).not.toContain('About')
    expect(html).not.toContain('<nav')
  })

  it('drops scripts, styles and inline handlers', () => {
    const { html } = extractPage(page, BASE)
    expect(html).not.toContain('window.analytics')
    expect(html).not.toContain('color: red')
    expect(html).not.toContain('tracker.js')
    expect(html).not.toContain('onclick')
  })

  it('absolutises what is left, so it still renders elsewhere', () => {
    const { html } = extractPage(page, BASE)
    expect(html).toContain('href="https://example.com/signup"')
    expect(html).toContain('src="https://example.com/hero.png"')
  })

  it('drops comments', () => {
    expect(extractPage('<body><!-- secret --><p>hi</p></body>', BASE).html).not.toContain('secret')
  })

  it('honours a <base href> over the page URL', () => {
    const html = '<head><base href="https://cdn.test/app/"></head><body><a href="x">go</a></body>'
    expect(extractPage(html, BASE).html).toContain('href="https://cdn.test/app/x"')
  })

  it('falls back to <article> when there is no <main>', () => {
    const html = '<body><nav>menu</nav><article><h1>Post</h1></article></body>'
    const out = extractPage(html, BASE).html
    expect(out).toContain('Post')
    expect(out).not.toContain('menu')
  })

  it('falls back to the body when the page marks nothing up', () => {
    const out = extractPage('<body><h1>Plain</h1></body>', BASE).html
    expect(out).toBe('<h1>Plain</h1>')
  })

  it('keeps the body when <main> is present but empty', () => {
    // An empty <main> is a layout artefact; narrowing into it would throw the
    // whole page away.
    const out = extractPage('<body><h1>Real</h1><main>  </main></body>', BASE).html
    expect(out).toContain('Real')
  })

  it('returns nothing visible for a page that is all script', () => {
    const { html } = extractPage('<body><script>app()</script></body>', BASE)
    expect(html).toBe('')
  })

  it('survives a document with no body tag at all', () => {
    expect(extractPage('<h1>Fragment</h1>', BASE).html).toBe('<h1>Fragment</h1>')
  })
})
