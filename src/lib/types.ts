/** Core domain types for Variant Lab. */

/** How an experiment's traffic is currently being handled. */
export type ExperimentStatus = 'draft' | 'running' | 'stopped'

export interface Experiment {
  id: string
  name: string
  /** The original page the variants were derived from. */
  baselineHtml: string
  /** Source URL, when the experiment was created from a live page. */
  sourceUrl: string | null
  status: ExperimentStatus
  createdAt: string
}

export interface Variant {
  id: string
  experimentId: string
  /** Human label, unique within an experiment (e.g. "control", "b"). */
  key: string
  html: string
  /**
   * Relative allocation weight. Weights do not have to sum to anything in
   * particular — a variant's share is `weight / sum(weights)`.
   */
  weight: number
  /** True for the untouched baseline. Exactly one per experiment. */
  isControl: boolean
  createdAt: string
}

export interface ExperimentWithVariants extends Experiment {
  variants: Variant[]
}

export interface Assignment {
  experimentId: string
  visitorId: string
  variantId: string
  assignedAt: string
}

/** A conversion (or any other tracked action) attributed to an assignment. */
export interface Event {
  id: string
  experimentId: string
  visitorId: string
  variantId: string
  /** e.g. "conversion", "click", "signup". */
  name: string
  /** Optional numeric payload — revenue, seconds on page, and so on. */
  value: number | null
  createdAt: string
}

/** Input shape for creating an experiment. */
export interface NewExperimentInput {
  name: string
  baselineHtml: string
  sourceUrl?: string | null
  status?: ExperimentStatus
  variants: NewVariantInput[]
}

export interface NewVariantInput {
  key: string
  html: string
  weight?: number
  isControl?: boolean
}
