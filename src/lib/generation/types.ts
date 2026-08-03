/** Types shared by every variant generator. */

export interface GenerationRequest {
  /** The page being tested, as HTML. The control is this, untouched. */
  baselineHtml: string
  /** What the page is trying to get a visitor to do. Sharpens the prompt. */
  goal?: string | null
  /** How many variants to produce, not counting the control. */
  count: number
}

export interface GeneratedVariant {
  /** Label within the experiment — "b", "c", … The control is never generated. */
  key: string
  html: string
  /** One line on what changed and why, shown next to the draft before it is saved. */
  rationale: string
}

/**
 * A source of variants.
 *
 * The API layer only ever sees this interface, so an LLM and the offline
 * rule engine are interchangeable — which is what makes the demo path and the
 * real path the same code path.
 */
export interface VariantProvider {
  readonly name: string
  /** False for providers that work with no credentials — the demo mode signal. */
  readonly needsApiKey: boolean
  generate(request: GenerationRequest): Promise<GeneratedVariant[]>
}

/**
 * Generation failed for a reason that is not the caller's fault: the upstream
 * model errored, timed out, or returned something unusable. Surfaces as a 502.
 */
export class GenerationError extends Error {}

/**
 * The generator ran fine and had nothing to offer — every draft was empty, or
 * identical to the page it was given. Not a 502: nothing is broken, and
 * retrying the same page gets the same answer. Surfaces as a 422.
 */
export class NoVariantsError extends GenerationError {}
