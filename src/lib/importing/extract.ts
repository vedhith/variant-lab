/**
 * Reducing a fetched page to something worth running an experiment on.
 *
 * A real landing page arrives wrapped in analytics tags, cookie banners, and a
 * navigation bar, none of which anyone is testing. What comes out of here is
 * the page's own content — the part a headline rewrite would actually change —
 * with the executable surface removed and relative links made absolute so it
 * still renders somewhere other than the site it came from.
 *
 * It is deliberately not a full readability port. Regex over HTML cannot be
 * complete, and this errs toward keeping too much rather than cleverly
 * discarding a section that turns out to be the offer.
 */

import { sanitizeGeneratedHtml } from '../generation/sanitize'

/** Elements removed with their contents — nothing inside them is page copy. */
const STRIPPED = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'object',
  'embed',
  'canvas',
] as const

/** Attributes holding a single URL that should survive being read elsewhere. */
const URL_ATTRS = ['href', 'src', 'poster', 'action'] as const

/** URL forms that are already resolved, or are not locations at all. */
const NON_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * The contents of the first `<tag>` element, honouring nesting.
 *
 * A non-greedy regex would stop at the first `</article>`, which on a page
 * whose article contains an article is the wrong half. This walks the tags
 * instead and returns null when the element never closes.
 */
export function elementContents(html: string, tag: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi')
  const first = open.exec(html)
  if (!first) return null
  // A self-closing form has no contents to speak of.
  if (first[0].endsWith('/>')) return null

  const start = first.index + first[0].length
  const boundary = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  boundary.lastIndex = start

  let depth = 1
  let match: RegExpExecArray | null
  while ((match = boundary.exec(html)) !== null) {
    if (match[1] === '/') {
      depth -= 1
      if (depth === 0) return html.slice(start, match.index)
    } else if (!match[0].endsWith('/>')) {
      depth += 1
    }
  }
  return null
}

/** The page title: `<title>`, falling back to the first heading. */
export function extractTitle(html: string): string | null {
  const title = elementContents(html, 'title')
  if (title) {
    const text = decodeEntities(title.replace(/\s+/g, ' ')).trim()
    if (text) return text
  }
  for (const tag of ['h1', 'h2']) {
    const heading = elementContents(html, tag)
    if (!heading) continue
    const text = decodeEntities(heading.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim()
    if (text) return text
  }
  return null
}

/** The `<base href>` a page declares, which overrides its own URL for links. */
function declaredBase(html: string, fallback: string): string {
  const match = /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html)
  const raw = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
  if (!raw) return fallback
  try {
    return new URL(decodeEntities(raw), fallback).toString()
  } catch {
    return fallback
  }
}

function absolutize(value: string, base: string): string {
  const trimmed = value.trim()
  if (!trimmed || NON_RELATIVE.test(trimmed)) return value
  try {
    return new URL(decodeEntities(trimmed), base).toString()
  } catch {
    return value
  }
}

/**
 * Rewrite relative URLs against the page's base.
 *
 * Without this, a fetched page shows broken images and dead links the moment
 * it is served from Variant Lab instead of from its own domain — and a
 * variant that looks broken loses a test for the wrong reason.
 */
export function resolveUrls(html: string, base: string): string {
  let out = html

  for (const attr of URL_ATTRS) {
    const pattern = new RegExp(`(\\b${attr}\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi')
    out = out.replace(pattern, (whole, prefix: string, _raw, dq?: string, sq?: string, bare?: string) => {
      const value = dq ?? sq ?? bare
      if (value === undefined) return whole
      const resolved = absolutize(value, base)
      if (resolved === value) return whole
      return `${prefix}"${resolved.replace(/"/g, '&quot;')}"`
    })
  }

  // srcset is a comma-separated list of "url descriptor" pairs.
  out = out.replace(
    /(\bsrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi,
    (whole, prefix: string, _raw, dq?: string, sq?: string) => {
      const value = dq ?? sq
      if (value === undefined) return whole
      const resolved = value
        .split(',')
        .map((candidate) => {
          const parts = candidate.trim().split(/\s+/)
          if (!parts[0]) return candidate.trim()
          parts[0] = absolutize(parts[0], base)
          return parts.join(' ')
        })
        .filter(Boolean)
        .join(', ')
      return `${prefix}"${resolved.replace(/"/g, '&quot;')}"`
    },
  )

  return out
}

export interface ExtractedPage {
  title: string | null
  html: string
}

/**
 * Pull the testable content out of a fetched document.
 *
 * `<main>` is preferred over `<article>` over `<body>`, in that order, because
 * a page that bothered to mark its main content has told us where the offer
 * is. Falling all the way through to the whole document is fine — worst case
 * the baseline carries a nav bar, which is what the visitor sees anyway.
 */
export function extractPage(rawHtml: string, pageUrl: string): ExtractedPage {
  const title = extractTitle(rawHtml)
  const base = declaredBase(rawHtml, pageUrl)

  let html = rawHtml.replace(/<!--[\s\S]*?-->/g, '')

  for (const tag of STRIPPED) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), '')
    html = html.replace(new RegExp(`</?${tag}\\b[^>]*>`, 'gi'), '')
  }

  const body = elementContents(html, 'body')
  if (body !== null) html = body

  const main = elementContents(html, 'main') ?? elementContents(html, 'article')
  if (main !== null && main.trim()) html = main

  html = resolveUrls(html, base)
  // The same filter generated variants go through. Fetched markup is at least
  // as untrusted as a model's output — it came from a site we do not control.
  html = sanitizeGeneratedHtml(html)
  html = html.replace(/\n{3,}/g, '\n\n').trim()

  return { title, html }
}
