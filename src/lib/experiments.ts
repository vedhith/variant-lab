import type { Db } from './db'
import { assignVariant } from './bucketing'
import { newExperimentId, newVariantId } from './ids'
import type {
  Assignment,
  Experiment,
  ExperimentStatus,
  ExperimentWithVariants,
  NewExperimentInput,
  Variant,
} from './types'

/** Thrown when caller input is bad — surfaces as a 400 at the API edge. */
export class ValidationError extends Error {}

/** Thrown when an id does not resolve — surfaces as a 404. */
export class NotFoundError extends Error {}

const MAX_NAME_LENGTH = 200
const MAX_HTML_BYTES = 512 * 1024
const MAX_VARIANTS = 10

interface ExperimentRow {
  id: string
  name: string
  baseline_html: string
  source_url: string | null
  status: ExperimentStatus
  created_at: string
}

interface VariantRow {
  id: string
  experiment_id: string
  key: string
  html: string
  weight: number
  is_control: number
  created_at: string
}

function toExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    name: row.name,
    baselineHtml: row.baseline_html,
    sourceUrl: row.source_url,
    status: row.status,
    createdAt: row.created_at,
  }
}

function toVariant(row: VariantRow): Variant {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    key: row.key,
    html: row.html,
    weight: row.weight,
    isControl: row.is_control === 1,
    createdAt: row.created_at,
  }
}

/**
 * Validate and normalise creation input.
 *
 * Done up front and in one place so the API layer stays thin and the rules
 * are testable without going through HTTP.
 */
function validate(input: NewExperimentInput): Required<
  Pick<NewExperimentInput, 'name' | 'baselineHtml'>
> & {
  sourceUrl: string | null
  status: ExperimentStatus
  variants: Array<{ key: string; html: string; weight: number; isControl: boolean }>
} {
  const name = (input?.name ?? '').trim()
  if (!name) throw new ValidationError('name is required')
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name must be at most ${MAX_NAME_LENGTH} characters`)
  }

  const baselineHtml = input?.baselineHtml ?? ''
  if (!baselineHtml.trim()) throw new ValidationError('baselineHtml is required')
  if (Buffer.byteLength(baselineHtml, 'utf8') > MAX_HTML_BYTES) {
    throw new ValidationError(`baselineHtml must be at most ${MAX_HTML_BYTES} bytes`)
  }

  if (!Array.isArray(input?.variants) || input.variants.length < 2) {
    throw new ValidationError('at least 2 variants are required')
  }
  if (input.variants.length > MAX_VARIANTS) {
    throw new ValidationError(`at most ${MAX_VARIANTS} variants are allowed`)
  }

  const sourceUrl = input.sourceUrl?.trim() || null
  if (sourceUrl !== null) {
    let parsed: URL
    try {
      parsed = new URL(sourceUrl)
    } catch {
      throw new ValidationError('sourceUrl must be a valid absolute URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError('sourceUrl must be http or https')
    }
  }

  const status = input.status ?? 'draft'
  if (!['draft', 'running', 'stopped'].includes(status)) {
    throw new ValidationError(`unknown status "${status}"`)
  }

  const seenKeys = new Set<string>()
  const variants = input.variants.map((v, index) => {
    const key = (v?.key ?? '').trim()
    if (!key) throw new ValidationError(`variant ${index}: key is required`)
    if (seenKeys.has(key)) throw new ValidationError(`duplicate variant key "${key}"`)
    seenKeys.add(key)

    const html = v?.html ?? ''
    if (!html.trim()) throw new ValidationError(`variant "${key}": html is required`)
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
      throw new ValidationError(`variant "${key}": html must be at most ${MAX_HTML_BYTES} bytes`)
    }

    const weight = v.weight ?? 1
    if (!Number.isFinite(weight) || weight < 0) {
      throw new ValidationError(`variant "${key}": weight must be a non-negative number`)
    }

    return { key, html, weight, isControl: v.isControl === true }
  })

  if (variants.every((v) => v.weight === 0)) {
    throw new ValidationError('at least one variant must have a non-zero weight')
  }

  const controls = variants.filter((v) => v.isControl)
  if (controls.length > 1) {
    throw new ValidationError('only one variant can be the control')
  }
  if (controls.length === 0) {
    // Default the first variant to control rather than rejecting — every
    // experiment needs a baseline to measure lift against.
    variants[0].isControl = true
  }

  return { name, baselineHtml, sourceUrl, status, variants }
}

export function createExperiment(
  db: Db,
  input: NewExperimentInput,
): ExperimentWithVariants {
  const clean = validate(input)
  const now = new Date().toISOString()
  const experimentId = newExperimentId()

  const insertExperiment = db.prepare(`
    INSERT INTO experiments (id, name, baseline_html, source_url, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertVariant = db.prepare(`
    INSERT INTO variants (id, experiment_id, key, html, weight, is_control, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  db.transaction(() => {
    insertExperiment.run(
      experimentId,
      clean.name,
      clean.baselineHtml,
      clean.sourceUrl,
      clean.status,
      now,
    )
    for (const v of clean.variants) {
      insertVariant.run(
        newVariantId(),
        experimentId,
        v.key,
        v.html,
        v.weight,
        v.isControl ? 1 : 0,
        now,
      )
    }
  })()

  return getExperiment(db, experimentId)
}

export function findExperiment(
  db: Db,
  experimentId: string,
): ExperimentWithVariants | null {
  const row = db
    .prepare('SELECT * FROM experiments WHERE id = ?')
    .get(experimentId) as ExperimentRow | undefined
  if (!row) return null

  const variantRows = db
    .prepare('SELECT * FROM variants WHERE experiment_id = ? ORDER BY key')
    .all(experimentId) as VariantRow[]

  return { ...toExperiment(row), variants: variantRows.map(toVariant) }
}

/** Like `findExperiment`, but throws `NotFoundError` instead of returning null. */
export function getExperiment(db: Db, experimentId: string): ExperimentWithVariants {
  const experiment = findExperiment(db, experimentId)
  if (!experiment) throw new NotFoundError(`no experiment with id "${experimentId}"`)
  return experiment
}

export function listExperiments(db: Db, limit = 50): Experiment[] {
  const rows = db
    .prepare('SELECT * FROM experiments ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit) as ExperimentRow[]
  return rows.map(toExperiment)
}

export interface AssignmentResult {
  assignment: Assignment
  variant: Variant
  /** False when the visitor already had an assignment we simply read back. */
  created: boolean
}

/**
 * Return the variant this visitor should see, assigning one on first contact.
 *
 * Stickiness has two layers. The hash in `assignVariant` means two servers
 * reach the same answer without talking to each other; the stored row means
 * the answer survives a later change to weights or to the variant list.
 */
export function assignVisitor(
  db: Db,
  experimentId: string,
  visitorId: string,
): AssignmentResult {
  const trimmedVisitor = visitorId?.trim()
  if (!trimmedVisitor) throw new ValidationError('visitorId is required')

  const experiment = getExperiment(db, experimentId)
  if (experiment.variants.length === 0) {
    throw new ValidationError('experiment has no variants')
  }

  const existing = db
    .prepare('SELECT * FROM assignments WHERE experiment_id = ? AND visitor_id = ?')
    .get(experimentId, trimmedVisitor) as
    | { experiment_id: string; visitor_id: string; variant_id: string; assigned_at: string }
    | undefined

  if (existing) {
    const variant = experiment.variants.find((v) => v.id === existing.variant_id)
    // The foreign key cascades, so a dangling assignment should be impossible.
    if (variant) {
      return {
        assignment: {
          experimentId: existing.experiment_id,
          visitorId: existing.visitor_id,
          variantId: existing.variant_id,
          assignedAt: existing.assigned_at,
        },
        variant,
        created: false,
      }
    }
  }

  const chosen = assignVariant(experimentId, trimmedVisitor, experiment.variants)
  const assignedAt = new Date().toISOString()

  // Two concurrent first-contact requests race here. Both compute the same
  // variant, so ignoring the loser's insert is correct rather than merely safe.
  db.prepare(`
    INSERT INTO assignments (experiment_id, visitor_id, variant_id, assigned_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (experiment_id, visitor_id) DO NOTHING
  `).run(experimentId, trimmedVisitor, chosen.id, assignedAt)

  return {
    assignment: {
      experimentId,
      visitorId: trimmedVisitor,
      variantId: chosen.id,
      assignedAt,
    },
    variant: chosen,
    created: true,
  }
}

/** Assignment counts per variant. Useful for sanity-checking a live split. */
export function assignmentCounts(db: Db, experimentId: string): Map<string, number> {
  const rows = db
    .prepare(
      'SELECT variant_id, COUNT(*) AS n FROM assignments WHERE experiment_id = ? GROUP BY variant_id',
    )
    .all(experimentId) as Array<{ variant_id: string; n: number }>

  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.variant_id, row.n)
  return counts
}
