/**
 * The prompt, and the parser for what comes back.
 *
 * Both are pure functions in their own file so they can be tested without a
 * network call or an API key — the two things most likely to be wrong about an
 * LLM integration are the instructions and the parsing, and neither needs a
 * live model to check.
 */

import { GenerationError, type GenerationRequest } from './types'

export const SYSTEM_PROMPT = [
  'You rewrite landing page HTML into alternative versions for an A/B test.',
  '',
  'Rules:',
  '- Change copy and layout emphasis only. Keep the page the same page.',
  '- Never invent facts. No statistics, customer counts, testimonials, prices,',
  '  guarantees, or awards that are not already in the input.',
  '- Keep every link href, form action, and input name exactly as given.',
  '- Return complete HTML for each variant, not a diff or a fragment.',
  '- No <script>, no inline event handlers, no javascript: URLs.',
  '- Each variant must test a different idea from the others.',
  '',
  'Respond with JSON only — no prose, no markdown fences — in this shape:',
  '{"variants":[{"rationale":"one sentence on what changed and what it tests",',
  '"html":"<the full variant HTML>"}]}',
].join('\n')

export function buildUserPrompt(request: GenerationRequest): string {
  const goal = request.goal?.trim()
  return [
    `Produce ${request.count} variant${request.count === 1 ? '' : 's'} of the page below.`,
    goal
      ? `The page is trying to get the visitor to: ${goal}`
      : 'The conversion goal was not stated — infer it from the page.',
    '',
    'Page HTML:',
    request.baselineHtml,
  ].join('\n')
}

export interface ParsedVariant {
  html: string
  rationale: string
}

/** Strip markdown fences and any prose wrapped around the JSON body. */
function extractJson(raw: string): string {
  let text = raw.trim()

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced) text = fenced[1].trim()

  // Models sometimes open with a sentence. Take the outermost JSON value.
  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')
  const start =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket)
  if (start === -1) return text

  const closer = text[start] === '{' ? '}' : ']'
  const end = text.lastIndexOf(closer)
  return end > start ? text.slice(start, end + 1) : text.slice(start)
}

function snippet(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim()
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat
}

/**
 * Turn a model response into variants, or fail loudly.
 *
 * Items that are individually unusable are dropped — a model that returns three
 * good variants and one empty one has still done the job — but a response with
 * nothing usable in it is an error, never an empty success. Silently returning
 * zero variants would look like "the page could not be improved".
 */
export function parseGeneratedVariants(raw: string): ParsedVariant[] {
  if (!raw.trim()) throw new GenerationError('the model returned an empty response')

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(raw))
  } catch {
    throw new GenerationError(`the model did not return JSON: ${snippet(raw)}`)
  }

  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { variants?: unknown })?.variants

  if (!Array.isArray(list)) {
    throw new GenerationError(`the model returned no "variants" array: ${snippet(raw)}`)
  }

  const variants: ParsedVariant[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const { html, rationale } = item as { html?: unknown; rationale?: unknown }
    if (typeof html !== 'string' || !html.trim()) continue
    variants.push({
      html: html.trim(),
      rationale: typeof rationale === 'string' && rationale.trim() ? rationale.trim() : 'No rationale given.',
    })
  }

  if (variants.length === 0) {
    throw new GenerationError(`the model returned no usable variants: ${snippet(raw)}`)
  }
  return variants
}
