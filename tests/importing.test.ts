import { describe, expect, it } from 'vitest'
import { POST as importRoute } from '@/app/api/import/route'
import { errorResponse } from '@/lib/api'
import { ValidationError } from '@/lib/experiments'
import { MAX_DOWNLOAD_BYTES, MAX_REDIRECTS, importPage } from '@/lib/importing'
import { EmptyPageError, ImportError } from '@/lib/importing/types'

const HTML = { 'content-type': 'text/html; charset=utf-8' }

const PAGE = `<!doctype html><html><head><title>Acme</title></head>
<body><main><h1>Ship faster</h1><a href="/signup">Start free</a></main></body></html>`

/** DNS that says yes to anything, so tests are about fetching, not resolving. */
const lookup = async () => ['93.184.216.34']

/** A fetch that serves a fixed map of URLs and records what it was asked for. */
function fakeFetch(routes: Record<string, Response | (() => Response)>) {
  const calls: string[] = []
  const fn = (async (input: URL | RequestInfo) => {
    const url = String(input)
    calls.push(url)
    const route = routes[url]
    if (!route) throw new Error(`nothing serving ${url}`)
    return typeof route === 'function' ? route() : route
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

function html(body: string, headers: Record<string, string> = HTML): Response {
  return new Response(body, { status: 200, headers })
}

function redirect(to: string, status = 302): Response {
  return new Response(null, { status, headers: { location: to } })
}

async function run(
  url: string,
  routes: Record<string, Response | (() => Response)>,
  extra: Parameters<typeof importPage>[1] = {},
) {
  const { fetch, calls } = fakeFetch(routes)
  const page = await importPage(url, { fetch, lookup, env: {}, ...extra })
  return { page, calls }
}

describe('importPage — the happy path', () => {
  it('fetches a page and returns a usable baseline', async () => {
    const { page } = await run('https://acme.test/pricing', {
      'https://acme.test/pricing': html(PAGE),
    })

    expect(page.requestedUrl).toBe('https://acme.test/pricing')
    expect(page.finalUrl).toBe('https://acme.test/pricing')
    expect(page.title).toBe('Acme')
    expect(page.html).toContain('Ship faster')
    expect(page.html).toContain('href="https://acme.test/signup"')
    expect(page.bytes).toBe(Buffer.byteLength(page.html, 'utf8'))
    expect(page.redirects).toBe(0)
  })

  it('asks for HTML and identifies itself', async () => {
    const { fetch } = fakeFetch({ 'https://acme.test/': html(PAGE) })
    const seen: RequestInit[] = []
    const spy = (async (input: URL | RequestInfo, init?: RequestInit) => {
      seen.push(init ?? {})
      return fetch(input, init)
    }) as unknown as typeof fetch

    await importPage('https://acme.test/', { fetch: spy, lookup, env: {} })

    const headers = seen[0].headers as Record<string, string>
    expect(headers.accept).toContain('text/html')
    expect(headers['user-agent']).toContain('variant-lab')
    // Redirects are followed by hand so every hop can be re-checked.
    expect(seen[0].redirect).toBe('manual')
  })
})

describe('importPage — redirects', () => {
  it('follows them and reports where it landed', async () => {
    const { page, calls } = await run('https://acme.test/old', {
      'https://acme.test/old': redirect('/new'),
      'https://acme.test/new': html(PAGE),
    })

    expect(page.finalUrl).toBe('https://acme.test/new')
    expect(page.redirects).toBe(1)
    expect(calls).toEqual(['https://acme.test/old', 'https://acme.test/new'])
  })

  it('re-checks each hop, so a redirect cannot smuggle in a private address', async () => {
    // The reason redirects are followed by hand: `redirect: "follow"` would
    // check the typed URL and then happily fetch the metadata service.
    const { fetch } = fakeFetch({
      'https://acme.test/go': redirect('http://169.254.169.254/latest/meta-data/'),
    })
    await expect(importPage('https://acme.test/go', { fetch, lookup, env: {} })).rejects.toThrow(
      ValidationError,
    )
  })

  it('refuses a redirect to a scheme that is not the web', async () => {
    const { fetch } = fakeFetch({ 'https://acme.test/go': redirect('file:///etc/passwd') })
    await expect(importPage('https://acme.test/go', { fetch, lookup, env: {} })).rejects.toThrow(
      /file: URL/,
    )
  })

  it('gives up on a redirect loop', async () => {
    const { fetch, calls } = fakeFetch({
      'https://acme.test/a': redirect('/b'),
      'https://acme.test/b': redirect('/a'),
    })
    await expect(importPage('https://acme.test/a', { fetch, lookup, env: {} })).rejects.toThrow(
      /too many redirects/,
    )
    expect(calls.length).toBe(MAX_REDIRECTS + 1)
  })

  it('complains when a redirect says nothing about where to go', async () => {
    const { fetch } = fakeFetch({
      'https://acme.test/go': new Response(null, { status: 302 }),
    })
    await expect(importPage('https://acme.test/go', { fetch, lookup, env: {} })).rejects.toThrow(
      /without saying where/,
    )
  })
})

describe('importPage — refusing what it should refuse', () => {
  it('rejects a bad URL before any fetch happens', async () => {
    const { fetch, calls } = fakeFetch({})
    await expect(importPage('not a url', { fetch, lookup, env: {} })).rejects.toThrow(
      ValidationError,
    )
    expect(calls).toEqual([])
  })

  it('reports an error status from the site', async () => {
    const { fetch } = fakeFetch({
      'https://acme.test/gone': new Response('nope', { status: 404, headers: HTML }),
    })
    await expect(importPage('https://acme.test/gone', { fetch, lookup, env: {} })).rejects.toThrow(
      /answered 404/,
    )
  })

  it('refuses a response that is not a web page', async () => {
    const { fetch } = fakeFetch({
      'https://acme.test/f.pdf': new Response('%PDF-1.4', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    })
    await expect(importPage('https://acme.test/f.pdf', { fetch, lookup, env: {} })).rejects.toThrow(
      /served application\/pdf/,
    )
  })

  it('refuses a body larger than the cap by its declared length', async () => {
    const { fetch } = fakeFetch({
      'https://acme.test/big': new Response('x', {
        status: 200,
        headers: { ...HTML, 'content-length': String(MAX_DOWNLOAD_BYTES + 1) },
      }),
    })
    await expect(importPage('https://acme.test/big', { fetch, lookup, env: {} })).rejects.toThrow(
      /larger than/,
    )
  })

  it('stops a body that lies about its length while streaming', async () => {
    // The cap has to hold when content-length is absent or wrong, or a server
    // that streams forever fills memory.
    const chunk = new Uint8Array(64 * 1024).fill(65)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
      },
    })
    const { fetch } = fakeFetch({
      'https://acme.test/endless': new Response(stream, { status: 200, headers: HTML }),
    })
    await expect(
      importPage('https://acme.test/endless', { fetch, lookup, env: {} }),
    ).rejects.toThrow(/larger than/)
  })

  it('turns a network failure into an import error, not a crash', async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    await expect(importPage('https://acme.test/', { fetch, lookup, env: {} })).rejects.toThrow(
      /could not reach acme.test/,
    )
  })

  it('gives up on a page that never answers', async () => {
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    await expect(
      importPage('https://acme.test/', { fetch, lookup, env: {}, timeoutMs: 5 }),
    ).rejects.toThrow(/timed out/)
  })

  it('reports a page with nothing in it as empty, not as a failure', async () => {
    const { fetch } = fakeFetch({
      'https://acme.test/app': html('<html><body><script>boot()</script></body></html>'),
    })
    await expect(importPage('https://acme.test/app', { fetch, lookup, env: {} })).rejects.toThrow(
      EmptyPageError,
    )
  })
})

describe('importPage — decoding', () => {
  it('honours the charset in the header', async () => {
    const bytes = new Uint8Array([0x3c, 0x68, 0x31, 0x3e, 0xe9, 0x3c, 0x2f, 0x68, 0x31, 0x3e]) // <h1>é</h1> in latin-1
    const { fetch } = fakeFetch({
      'https://acme.test/fr': new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      }),
    })
    const page = await importPage('https://acme.test/fr', { fetch, lookup, env: {} })
    expect(page.html).toContain('é')
  })

  it('falls back to the charset the document declares', async () => {
    const prefix = Buffer.from('<meta charset="iso-8859-1"><h1>', 'ascii')
    const bytes = Buffer.concat([prefix, Buffer.from([0xe9]), Buffer.from('</h1>', 'ascii')])
    const { fetch } = fakeFetch({
      'https://acme.test/fr': new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    })
    const page = await importPage('https://acme.test/fr', { fetch, lookup, env: {} })
    expect(page.html).toContain('é')
  })

  it('ignores a charset it does not know rather than failing the import', async () => {
    const { fetch } = fakeFetch({
      'https://acme.test/x': new Response('<h1>Fine</h1>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=x-made-up' },
      }),
    })
    const page = await importPage('https://acme.test/x', { fetch, lookup, env: {} })
    expect(page.html).toContain('Fine')
  })
})

describe('POST /api/import', () => {
  async function post(body: unknown) {
    const res = await importRoute(
      new Request('http://test/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )
    return { status: res.status, body: await res.json() }
  }

  // These all fail before a socket is opened, so the route is exercised for
  // real without the test suite ever making a network call.
  it('rejects a missing url with 400', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('rejects a non-JSON body with 400', async () => {
    expect((await post('{oops')).status).toBe(400)
  })

  it('rejects a private address with 400 and says why', async () => {
    const res = await post({ url: 'http://169.254.169.254/latest/meta-data/' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not a public address/)
  })

  it('rejects a file URL with 400', async () => {
    expect((await post({ url: 'file:///etc/passwd' })).status).toBe(400)
  })
})

describe('error mapping', () => {
  it('sends an unreachable page back as 502', () => {
    expect(errorResponse(new ImportError('acme.test answered 503')).status).toBe(502)
  })

  it('sends an empty page back as 422 — nothing is broken, retrying will not help', () => {
    expect(errorResponse(new EmptyPageError('no content')).status).toBe(422)
  })
})
