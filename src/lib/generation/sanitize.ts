/**
 * Conservative filter over generated HTML.
 *
 * Variant HTML is served back to visitors, and a model's output is not
 * something to hand over verbatim: a hallucinated `<script>` or an `onerror=`
 * would execute on someone else's page. This strips the executable surface and
 * leaves the markup alone otherwise.
 *
 * It is a filter over *model output*, not a general-purpose sanitizer for
 * hostile input — it is regex over HTML, which cannot be complete. Pasted
 * baseline HTML is still treated as trusted and stored verbatim; the point here
 * is that nothing the generator invents becomes executable without a human
 * having looked at it.
 */

/** Elements dropped entirely, content included. */
const DROPPED_ELEMENTS = ['script', 'iframe', 'object', 'embed', 'noscript'] as const

/** Elements dropped as single tags — they carry no content of their own. */
const DROPPED_VOID_ELEMENTS = ['link', 'meta', 'base'] as const

const EVENT_HANDLER_ATTR = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

/** `href="javascript:…"`, in any of the three quoting styles. */
const JS_URL_ATTR = /\s+(href|src|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi

export function sanitizeGeneratedHtml(html: string): string {
  let out = html

  for (const tag of DROPPED_ELEMENTS) {
    // Paired form first, then any unclosed leftover tag.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '')
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  }

  for (const tag of DROPPED_VOID_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '')
  }

  out = out.replace(EVENT_HANDLER_ATTR, '')
  out = out.replace(JS_URL_ATTR, '')

  return out.trim()
}

/** True when a sanitized draft still carries something worth showing. */
export function hasVisibleContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
