/**
 * Variant generation: pick a provider, run it, and make what it returns safe
 * to show and safe to save.
 *
 * The provider boundary is the point of this module. `POST /api/generate` does
 * not know whether a variant came from a model or from the offline rules, so
 * the demo path and the paid path are the same path — the one place where "it
 * works without an API key" usually stops being true is where the two diverge.
 */

import { MAX_HTML_BYTES, ValidationError } from '../experiments'
import { createAnthropicProvider } from './anthropic'
import { normalizeHtml } from './html'
import { variantKey } from './keys'
import { createRuleProvider } from './rules'
import { hasVisibleContent, sanitizeGeneratedHtml } from './sanitize'
import {
  GenerationError,
  NoVariantsError,
  type GeneratedVariant,
  type GenerationRequest,
  type VariantProvider,
} from './types'

export const DEFAULT_VARIANT_COUNT = 2
export const MAX_VARIANT_COUNT = 5
const MAX_GOAL_LENGTH = 300

export type ProviderEnv = Record<string, string | undefined>

/**
 * Which provider a given environment gets.
 *
 * An API key present means the caller wants the model; no key means the rules,
 * without an error and without a prompt to go get one. `VARIANT_LAB_PROVIDER`
 * overrides both, so the rules can be exercised on a machine that does have a
 * key — which is exactly what CI does.
 */
export function resolveProvider(env: ProviderEnv = process.env): VariantProvider {
  const requested = env.VARIANT_LAB_PROVIDER?.trim().toLowerCase()
  const apiKey = env.ANTHROPIC_API_KEY?.trim()

  if (requested === 'rules') return createRuleProvider()
  if (requested === 'anthropic' || (!requested && apiKey)) {
    if (!apiKey) {
      throw new GenerationError(
        'VARIANT_LAB_PROVIDER=anthropic needs ANTHROPIC_API_KEY to be set',
      )
    }
    return createAnthropicProvider({
      apiKey,
      model: env.ANTHROPIC_MODEL?.trim() || undefined,
      baseUrl: env.ANTHROPIC_BASE_URL?.trim() || undefined,
    })
  }
  if (requested) throw new GenerationError(`unknown provider "${requested}"`)

  return createRuleProvider()
}

/** Validate and normalise a generation request. Bad input is the caller's fault: 400. */
export function validateGenerationRequest(input: {
  baselineHtml?: unknown
  goal?: unknown
  count?: unknown
}): GenerationRequest {
  const baselineHtml = typeof input.baselineHtml === 'string' ? input.baselineHtml : ''
  if (!baselineHtml.trim()) throw new ValidationError('baselineHtml is required')
  if (Buffer.byteLength(baselineHtml, 'utf8') > MAX_HTML_BYTES) {
    throw new ValidationError(`baselineHtml must be at most ${MAX_HTML_BYTES} bytes`)
  }

  let goal: string | null = null
  if (input.goal !== undefined && input.goal !== null) {
    if (typeof input.goal !== 'string') throw new ValidationError('goal must be a string')
    goal = input.goal.trim() || null
    if (goal && goal.length > MAX_GOAL_LENGTH) {
      throw new ValidationError(`goal must be at most ${MAX_GOAL_LENGTH} characters`)
    }
  }

  const count = input.count === undefined || input.count === null ? DEFAULT_VARIANT_COUNT : input.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_VARIANT_COUNT) {
    throw new ValidationError(`count must be an integer between 1 and ${MAX_VARIANT_COUNT}`)
  }

  return { baselineHtml, goal, count }
}

export interface GenerationResult {
  provider: string
  variants: GeneratedVariant[]
  /** True when fewer variants came back than were asked for. */
  short: boolean
}

/**
 * Run a provider and clean up after it.
 *
 * Three things are enforced here rather than trusted to the provider, because
 * the provider is the part most likely to be someone else's code: the HTML is
 * stripped of anything executable, drafts identical to the baseline or to each
 * other are dropped, and keys are assigned after that filtering so they stay
 * contiguous ("b", "c") instead of gapping wherever a draft was rejected.
 */
export async function generateVariants(
  request: GenerationRequest,
  provider: VariantProvider,
): Promise<GenerationResult> {
  const drafts = await provider.generate(request)
  if (!Array.isArray(drafts)) {
    throw new GenerationError(`provider "${provider.name}" returned no variants`)
  }

  const baseline = normalizeHtml(request.baselineHtml)
  const seen = new Set<string>([baseline])
  const kept: GeneratedVariant[] = []

  for (const draft of drafts) {
    if (kept.length >= request.count) break
    const html = sanitizeGeneratedHtml(draft?.html ?? '')
    if (!html || !hasVisibleContent(html)) continue
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) continue

    const fingerprint = normalizeHtml(html)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)

    kept.push({
      key: variantKey(kept.length),
      html,
      rationale: draft.rationale?.trim() || 'No rationale given.',
    })
  }

  if (kept.length === 0) {
    throw new NoVariantsError(
      `${provider.name} produced nothing that differs from the page you gave it`,
    )
  }

  return { provider: provider.name, variants: kept, short: kept.length < request.count }
}

export { GenerationError, NoVariantsError } from './types'
export type { GeneratedVariant, GenerationRequest, VariantProvider } from './types'
