/**
 * The offline provider: deterministic copy rules, no API key, no network.
 *
 * This exists so the whole pipeline — generate, review, save, split, measure —
 * can be run by someone who has just cloned the repo, and so CI exercises the
 * same path in a few milliseconds. It is a rewriter, not a copywriter: every
 * rule is a mechanical edit to text that is already on the page, and none of
 * them introduce a claim the page was not already making. That constraint is
 * deliberate — a generator that invents "trusted by 10,000 teams" to win a test
 * is a liability, not a feature.
 *
 * A rule returns `null` when it has nothing to say about a page. Producing
 * fewer variants than asked for is the honest outcome; padding the list with
 * copies of the baseline is not.
 */

import { findCta, findHeadline, replaceSlot, type TextSlot } from './html'
import { variantKey } from './keys'
import type { GeneratedVariant, GenerationRequest, VariantProvider } from './types'

interface RuleOutput {
  html: string
  rationale: string
}

interface Rule {
  key: string
  apply(html: string): RuleOutput | null
}

/** Marketing intensifiers that survive deletion without changing the meaning. */
const HYPE_PHRASES = [
  'world-class',
  'world class',
  'best-in-class',
  'best in class',
  'state-of-the-art',
  'state of the art',
  'next-generation',
  'next generation',
  'cutting-edge',
  'cutting edge',
  'game-changing',
  'game changing',
]

const HYPE_WORDS = new Set([
  'very',
  'really',
  'truly',
  'simply',
  'just',
  'actually',
  'literally',
  'amazing',
  'incredible',
  'incredibly',
  'revolutionary',
  'powerful',
  'robust',
  'innovative',
  'seamless',
  'seamlessly',
  'effortless',
  'effortlessly',
  'ultimate',
  'unparalleled',
  'unmatched',
  'blazing',
  'blazingly',
  'extremely',
  'super',
])

/** Verbs common enough at the front of a landing-page headline to read as a command. */
const IMPERATIVE_VERBS = new Set([
  'ship',
  'build',
  'get',
  'start',
  'launch',
  'grow',
  'save',
  'scale',
  'track',
  'stop',
  'make',
  'turn',
  'cut',
  'boost',
  'automate',
  'create',
  'find',
  'learn',
  'try',
  'join',
  'discover',
  'run',
  'write',
  'design',
  'sell',
  'measure',
  'test',
  'deploy',
  'manage',
  'monitor',
  'optimize',
  'optimise',
  'send',
  'see',
  'close',
  'fix',
  'plan',
])

/**
 * Vague CTAs and a more immediate phrasing of the same ask.
 *
 * Every replacement promises exactly what the original did — "Learn more" and
 * "See how it works" cost the visitor the same click. Nothing here adds "free"
 * or "instant" to a button that did not already say so.
 */
const CTA_REWRITES = new Map<string, string>([
  ['learn more', 'See how it works'],
  ['read more', 'See how it works'],
  ['find out more', 'See how it works'],
  ['sign up', 'Get started'],
  ['submit', 'Send it'],
  ['get started', 'Start now'],
  ['contact us', 'Talk to us'],
  ['request a demo', 'See a demo'],
  ['book a demo', 'See a demo'],
  ['subscribe', 'Get updates'],
  ['click here', 'See how it works'],
])

const CLAUSE_BOUNDARIES = [' — ', ' – ', ' - ', ', ', ': ', '; ']
const LONG_HEADLINE_WORDS = 8

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

function bareWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function lowercaseFirstWord(text: string): string {
  const [first, ...rest] = words(text)
  if (!first) return text
  // Leave acronyms and product names alone — "API" must not become "aPI".
  const isAcronymOrName = first.slice(1) !== first.slice(1).toLowerCase()
  const head = isAcronymOrName ? first : first.toLowerCase()
  return [head, ...rest].join(' ')
}

/** Apply a rewrite to a slot's text, or give up if it did not actually change. */
function rewriteSlot(
  html: string,
  slot: TextSlot | null,
  rewrite: (text: string) => string | null,
  rationale: (before: string, after: string) => string,
): RuleOutput | null {
  if (!slot) return null
  const before = slot.text.trim()
  const after = rewrite(before)
  if (!after || after === before) return null
  return { html: replaceSlot(html, slot, after), rationale: rationale(before, after) }
}

const RULES: readonly Rule[] = [
  {
    key: 'plain-headline',
    apply(html) {
      return rewriteSlot(
        html,
        findHeadline(html),
        (text) => {
          let stripped = text
          for (const phrase of HYPE_PHRASES) {
            stripped = stripped.replace(new RegExp(`\\b${phrase}\\b\\s*`, 'gi'), '')
          }
          const kept = words(stripped).filter((word) => !HYPE_WORDS.has(bareWord(word)))
          // Below two words there is no headline left to test.
          if (kept.length < 2) return null
          return capitalizeFirst(kept.join(' '))
        },
        (before, after) =>
          `Headline with the intensifiers removed: "${before}" → "${after}". Tests whether the ` +
          `claim carries the page on its own.`,
      )
    },
  },
  {
    key: 'short-headline',
    apply(html) {
      return rewriteSlot(
        html,
        findHeadline(html),
        (text) => {
          if (words(text).length <= LONG_HEADLINE_WORDS) return null
          const cut = CLAUSE_BOUNDARIES.map((sep) => text.indexOf(sep))
            .filter((index) => index > 0)
            .sort((a, b) => a - b)[0]
          // No clause boundary means no safe place to cut — truncating a single
          // clause mid-thought produces a headline nobody would have written.
          if (cut === undefined) return null
          const head = text.slice(0, cut).replace(/[\s,;:—–-]+$/, '')
          if (words(head).length < 3) return null
          return head
        },
        (before, after) =>
          `Headline cut to its first clause: "${after}" instead of "${before}". Tests whether ` +
          `the qualifier was earning its place.`,
      )
    },
  },
  {
    key: 'question-headline',
    apply(html) {
      return rewriteSlot(
        html,
        findHeadline(html),
        (text) => {
          if (text.endsWith('?')) return null
          const first = bareWord(words(text)[0] ?? '')
          // Only commands convert cleanly into a question; a noun-phrase
          // headline turned into one reads like a quiz.
          if (!IMPERATIVE_VERBS.has(first)) return null
          const body = lowercaseFirstWord(text.replace(/[.!]+$/, ''))
          return `Ready to ${body}?`
        },
        (before, after) =>
          `Headline asked rather than told: "${after}" instead of "${before}". Tests a lower-` +
          `pressure open.`,
      )
    },
  },
  {
    key: 'direct-cta',
    apply(html) {
      return rewriteSlot(
        html,
        findCta(html),
        (text) => CTA_REWRITES.get(text.toLowerCase().replace(/[.!\s]+$/, '')) ?? null,
        (before, after) =>
          `Call to action made concrete: "${after}" instead of "${before}". The click costs the ` +
          `visitor exactly the same thing either way.`,
      )
    },
  },
]

/** The offline provider. Deterministic: the same page always yields the same drafts. */
export function createRuleProvider(): VariantProvider {
  return {
    name: 'rules',
    needsApiKey: false,
    async generate(request: GenerationRequest): Promise<GeneratedVariant[]> {
      const produced: GeneratedVariant[] = []
      for (const rule of RULES) {
        if (produced.length >= request.count) break
        const output = rule.apply(request.baselineHtml)
        if (!output) continue
        produced.push({
          key: variantKey(produced.length),
          html: output.html,
          rationale: output.rationale,
        })
      }
      return produced
    },
  }
}

/** Exposed for the tests and for the "what can this do" line in the UI. */
export const RULE_KEYS: readonly string[] = RULES.map((rule) => rule.key)
