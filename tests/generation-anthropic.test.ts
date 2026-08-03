import { describe, expect, it } from 'vitest'
import { createAnthropicProvider, DEFAULT_MODEL } from '@/lib/generation/anthropic'
import { GenerationError } from '@/lib/generation/types'

const REQUEST = { baselineHtml: '<h1>Ship faster</h1>', goal: 'sign up', count: 2 }

function modelResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status })
}

const TWO_VARIANTS = JSON.stringify({
  variants: [
    { rationale: 'Shorter.', html: '<h1>Ship</h1>' },
    { rationale: 'CTA.', html: '<h1>Ship faster</h1><button>Start now</button>' },
  ],
})

/** Records the call so the request shape can be asserted, then replies. */
function stubFetch(reply: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return reply()
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('anthropic provider', () => {
  it('posts to the Messages API with the key, version, and model', async () => {
    const { impl, calls } = stubFetch(() => modelResponse(TWO_VARIANTS))
    const provider = createAnthropicProvider({ apiKey: 'test-key', fetchImpl: impl })

    await provider.generate(REQUEST)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(calls[0].init.body as string)
    expect(body.model).toBe(DEFAULT_MODEL)
    expect(body.system).toMatch(/Never invent facts/)
    expect(body.messages[0].content).toContain('<h1>Ship faster</h1>')
    expect(body.messages[0].content).toContain('sign up')
  })

  it('honours an overridden model and base url, without doubling the slash', async () => {
    const { impl, calls } = stubFetch(() => modelResponse(TWO_VARIANTS))
    const provider = createAnthropicProvider({
      apiKey: 'k',
      model: 'claude-haiku-4-5-20251001',
      baseUrl: 'https://proxy.internal/',
      fetchImpl: impl,
    })

    await provider.generate(REQUEST)

    expect(calls[0].url).toBe('https://proxy.internal/v1/messages')
    expect(JSON.parse(calls[0].init.body as string).model).toBe('claude-haiku-4-5-20251001')
  })

  it('returns keyed variants', async () => {
    const { impl } = stubFetch(() => modelResponse(TWO_VARIANTS))
    const provider = createAnthropicProvider({ apiKey: 'k', fetchImpl: impl })

    const variants = await provider.generate(REQUEST)

    expect(variants.map((v) => v.key)).toEqual(['b', 'c'])
    expect(variants[0].html).toBe('<h1>Ship</h1>')
    expect(variants[0].rationale).toBe('Shorter.')
  })

  it('joins multiple text blocks before parsing', async () => {
    const half = TWO_VARIANTS.slice(0, 30)
    const rest = TWO_VARIANTS.slice(30)
    const { impl } = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [
              { type: 'thinking' },
              { type: 'text', text: half },
              { type: 'text', text: rest },
            ],
          }),
          { status: 200 },
        ),
    )

    const variants = await createAnthropicProvider({ apiKey: 'k', fetchImpl: impl }).generate(REQUEST)
    expect(variants).toHaveLength(2)
  })

  it('passes an upstream error message through', async () => {
    const { impl } = stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }),
    )
    const provider = createAnthropicProvider({ apiKey: 'bad', fetchImpl: impl })

    await expect(provider.generate(REQUEST)).rejects.toThrow(/401: invalid x-api-key/)
  })

  it('reports a non-JSON upstream response with its status', async () => {
    const { impl } = stubFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    const provider = createAnthropicProvider({ apiKey: 'k', fetchImpl: impl })

    await expect(provider.generate(REQUEST)).rejects.toThrow(/non-JSON response \(502\)/)
  })

  it('reports a network failure as a generation error, not a crash', async () => {
    const impl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as unknown as typeof fetch
    const provider = createAnthropicProvider({ apiKey: 'k', fetchImpl: impl })

    await expect(provider.generate(REQUEST)).rejects.toThrow(/could not reach the model/)
  })

  it('reports a timeout by name', async () => {
    const impl = (async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch
    const provider = createAnthropicProvider({ apiKey: 'k', fetchImpl: impl, timeoutMs: 10 })

    await expect(provider.generate(REQUEST)).rejects.toThrow(/did not respond within 10 ms/)
  })

  it('refuses to be constructed without a key', () => {
    expect(() => createAnthropicProvider({ apiKey: '' })).toThrow(GenerationError)
  })
})
