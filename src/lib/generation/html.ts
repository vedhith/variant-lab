/**
 * Just enough HTML surgery for the offline rule engine.
 *
 * The rules only ever rewrite the text inside one element — a headline or a
 * call to action — so this finds that text and its offsets and nothing more.
 * Elements whose contents are not plain text are skipped rather than guessed
 * at: mangling someone's markup to force a variant out is worse than declining
 * to produce one.
 */

export interface TextSlot {
  /** Offset of the first character of the inner text. */
  start: number
  /** Offset just past the last character of the inner text. */
  end: number
  /** The inner text, exactly as it appears. */
  text: string
  /** Tag name the text was found in, lowercased. */
  tag: string
}

/** Matches `<tag …>inner</tag>` for a given tag, capturing the inner content. */
function elementPattern(tag: string): RegExp {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i')
}

function slotFor(html: string, tag: string): TextSlot | null {
  const match = elementPattern(tag).exec(html)
  if (!match) return null

  const inner = match[1]
  // Nested markup means the "text" is not a single run we can swap out.
  if (inner.includes('<') || !inner.trim()) return null

  const start = match.index + match[0].indexOf(inner)
  return { start, end: start + inner.length, text: inner, tag }
}

/** The first `<h1>`, else `<h2>`, else `<h3>` with plain-text contents. */
export function findHeadline(html: string): TextSlot | null {
  for (const tag of ['h1', 'h2', 'h3']) {
    const slot = slotFor(html, tag)
    if (slot) return slot
  }
  return null
}

/**
 * The page's call to action: the first `<button>`, else the first `<a>`.
 *
 * A link is a weaker signal than a button — plenty of pages have navigation
 * before their CTA — but on the single-section landing pages this tool is for,
 * the first link is usually the ask.
 */
export function findCta(html: string): TextSlot | null {
  for (const tag of ['button', 'a']) {
    const slot = slotFor(html, tag)
    if (slot) return slot
  }
  return null
}

/** Replace a slot's text, preserving the surrounding whitespace of the original. */
export function replaceSlot(html: string, slot: TextSlot, text: string): string {
  const leading = slot.text.match(/^\s*/)?.[0] ?? ''
  const trailing = slot.text.match(/\s*$/)?.[0] ?? ''
  return html.slice(0, slot.start) + leading + text + trailing + html.slice(slot.end)
}

/** Collapse runs of whitespace so two drafts can be compared for real difference. */
export function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, ' ').trim()
}
