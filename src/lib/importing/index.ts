/**
 * Import a live page as an experiment baseline.
 *
 * `POST /api/experiments` has always accepted pasted HTML. This is the other
 * half of the promise: give it a URL and it fetches the page, reduces it to
 * its content, and hands back something you can generate variants from.
 *
 * The fetching here is deliberately unlike a browser's. Redirects are followed
 * by hand so every hop is checked instead of only the first, the body is read
 * through a byte counter that stops rather than buffering whatever arrives,
 * and a response that is not HTML is refused before any of it is parsed.
 */

import { MAX_HTML_BYTES, ValidationError } from '../experiments'
import { hasVisibleContent } from '../generation/sanitize'
import { extractPage } from './extract'
import { assertPublicTarget, defaultLookup, parseTargetUrl, type Lookup } from './target'
import { EmptyPageError, ImportError, type ImportedPage } from './types'

/** Redirect chains longer than this are a loop or a tracker, not a page. */
export const MAX_REDIRECTS = 5

/**
 * Cap on the bytes read off the wire, four times the cap on a stored baseline.
 * Raw pages carry markup that extraction throws away, so the download budget
 * has to be looser than the budget for what is kept.
 */
export const MAX_DOWNLOAD_BYTES = 4 * MAX_HTML_BYTES

/** How long the whole fetch gets, redirects included. */
export const FETCH_TIMEOUT_MS = 10_000

const HTML_TYPES = ['text/html', 'application/xhtml+xml', 'application/xml', 'text/xml']

export interface ImportDeps {
  fetch?: typeof fetch
  lookup?: Lookup
  env?: Record<string, string | undefined>
  /** Overall budget in milliseconds. Exposed so tests do not wait on it. */
  timeoutMs?: number
}

function contentTypeOf(res: Response): string {
  return (res.headers.get('content-type') ?? '').toLowerCase()
}

/** The charset named in a `content-type` header, if it named one. */
function headerCharset(contentType: string): string | null {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)
  return match ? match[1].toLowerCase() : null
}

/** The charset a document declares in its own `<meta>`, if any. */
function metaCharset(html: string): string | null {
  const direct = /<meta\b[^>]*\bcharset\s*=\s*["']?([a-z0-9_:.+-]+)/i.exec(html)
  if (direct) return direct[1].toLowerCase()
  const http = /<meta\b[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_:.+-]+)/i.exec(html)
  return http ? http[1].toLowerCase() : null
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/**
 * Read a response body, refusing to buffer more than the cap.
 *
 * The check is per chunk as it arrives, so a server that advertises 2 KB and
 * then streams forever is cut off at the limit instead of filling memory. A
 * `content-length` that already exceeds the cap is rejected before the first
 * byte is read.
 */
async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    throw new ImportError(`page is larger than ${Math.round(limit / 1024)} KB`)
  }

  const body = res.body
  if (!body) {
    const buffer = new Uint8Array(await res.arrayBuffer())
    if (buffer.byteLength > limit) {
      throw new ImportError(`page is larger than ${Math.round(limit / 1024)} KB`)
    }
    return buffer
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > limit) {
        throw new ImportError(`page is larger than ${Math.round(limit / 1024)} KB`)
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

interface FetchOutcome {
  finalUrl: URL
  html: string
  redirects: number
}

/**
 * Walk the redirect chain by hand, checking each hop.
 *
 * `redirect: 'follow'` would validate only the URL that was typed; a site that
 * answers `302 Location: http://169.254.169.254/` would then be fetched with
 * no check at all. Every hop goes back through the same address guard.
 */
async function fetchDocument(
  start: URL,
  deps: Required<Pick<ImportDeps, 'fetch' | 'lookup' | 'env'>>,
  signal: AbortSignal,
): Promise<FetchOutcome> {
  let url = start

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let res: Response
    try {
      res = await deps.fetch(url, {
        redirect: 'manual',
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'variant-lab/0.1 (+https://github.com/vedhith/variant-lab)',
        },
      })
    } catch (err) {
      if (signal.aborted) throw new ImportError(`fetching ${url.host} timed out`)
      throw new ImportError(`could not reach ${url.host}: ${(err as Error).message}`)
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new ImportError(`${url.host} redirected without saying where`)
      if (hop === MAX_REDIRECTS) throw new ImportError('too many redirects')

      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new ImportError(`${url.host} redirected to an unreadable location`)
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new ImportError(`${url.host} redirected to a ${next.protocol} URL`)
      }
      await assertPublicTarget(next, deps.lookup, deps.env)
      url = next
      continue
    }

    if (!res.ok) {
      throw new ImportError(`${url.host} answered ${res.status}`)
    }

    const contentType = contentTypeOf(res)
    const mime = contentType.split(';')[0].trim()
    if (mime && !HTML_TYPES.includes(mime)) {
      throw new ImportError(`${url.host} served ${mime}, not a web page`)
    }

    const bytes = await readCapped(res, MAX_DOWNLOAD_BYTES)
    const declaredCharset = headerCharset(contentType)
    let html = decode(bytes, declaredCharset ?? 'utf-8')
    // Plenty of pages declare their encoding only in the document. Re-decode
    // when the document disagrees with the (absent) header rather than serving
    // a baseline full of replacement characters.
    if (!declaredCharset) {
      const declared = metaCharset(html)
      if (declared && declared !== 'utf-8' && declared !== 'utf8') {
        html = decode(bytes, declared)
      }
    }

    return { finalUrl: url, html, redirects: hop }
  }

  throw new ImportError('too many redirects')
}

/**
 * Fetch a URL and return a baseline ready to experiment on.
 *
 * Throws `ValidationError` for a URL we will not fetch (400), `ImportError`
 * when the fetch itself fails (502), and `EmptyPageError` when the page came
 * back but held nothing testable (422).
 */
export async function importPage(rawUrl: unknown, deps: ImportDeps = {}): Promise<ImportedPage> {
  const env = deps.env ?? process.env
  const doFetch = deps.fetch ?? fetch
  const lookup = deps.lookup ?? defaultLookup

  const url = parseTargetUrl(rawUrl)
  await assertPublicTarget(url, lookup, env)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS)

  let outcome: FetchOutcome
  try {
    outcome = await fetchDocument(url, { fetch: doFetch, lookup, env }, controller.signal)
  } finally {
    clearTimeout(timer)
  }

  const extracted = extractPage(outcome.html, outcome.finalUrl.toString())
  if (!extracted.html || !hasVisibleContent(extracted.html)) {
    throw new EmptyPageError(`${outcome.finalUrl.host} has no page content we can test`)
  }

  const bytes = Buffer.byteLength(extracted.html, 'utf8')
  if (bytes > MAX_HTML_BYTES) {
    throw new ImportError(
      `the page is ${Math.round(bytes / 1024)} KB after cleanup, over the ${Math.round(
        MAX_HTML_BYTES / 1024,
      )} KB limit for a baseline`,
    )
  }

  return {
    requestedUrl: url.toString(),
    finalUrl: outcome.finalUrl.toString(),
    title: extracted.title,
    html: extracted.html,
    bytes,
    redirects: outcome.redirects,
  }
}

export { EmptyPageError, ImportError, ValidationError }
export type { ImportedPage }
