import type { Db } from './db'
import { getExperiment } from './experiments'
import { DEFAULT_EVENT_NAME } from './events'
import {
  type Comparison,
  type Interval,
  compareProportions,
  rate,
  wilsonInterval,
} from './stats'

/**
 * Turning stored rows into a result a person can act on.
 *
 * The counting rule is the one that matters here: a variant's conversions are
 * its *distinct converting visitors*, not its event rows. A visitor who clicks
 * the button five times is one conversion out of one visitor — counting rows
 * would inflate the rate past 100% and quietly break every test below.
 */

export interface VariantOutcome {
  variantId: string
  key: string
  isControl: boolean
  /** Visitors assigned to this variant. */
  visitors: number
  /** Distinct visitors who fired the event at least once. */
  conversions: number
  /** conversions / visitors, or 0 when nobody has been assigned yet. */
  rate: number
  /** 95% Wilson interval on `rate`, or null with no visitors. */
  interval: Interval | null
}

/** A variant's outcome alongside how it compares to the control. */
export interface VariantResult extends VariantOutcome {
  /** Null for the control itself, and when the experiment has no control. */
  comparison: Comparison | null
}

export interface ExperimentResults {
  experimentId: string
  name: string
  status: string
  /** Which event name these numbers count. */
  eventName: string
  variants: VariantResult[]
  totals: { visitors: number; conversions: number; rate: number }
  /** The control's outcome, or null if the experiment somehow has none. */
  control: VariantOutcome | null
  /**
   * The variant with the best rate among those significantly beating the
   * control. Null when nothing has separated from the control yet — which is
   * the honest answer on day one and most of day two.
   */
  leader: VariantResult | null
}

interface OutcomeRow {
  variant_id: string
  key: string
  is_control: number
  visitors: number
  conversions: number
}

/**
 * Compute results for one experiment and one event name.
 *
 * Throws `NotFoundError` if the experiment does not exist. Zero traffic, a
 * single variant, and exact ties are all normal inputs, not error cases.
 */
export function experimentResults(
  db: Db,
  experimentId: string,
  eventName: string = DEFAULT_EVENT_NAME,
): ExperimentResults {
  const experiment = getExperiment(db, experimentId)
  const name = eventName.trim() || DEFAULT_EVENT_NAME

  const rows = db
    .prepare(
      `SELECT v.id                                     AS variant_id,
              v.key                                    AS key,
              v.is_control                             AS is_control,
              (SELECT COUNT(*)
                 FROM assignments a
                WHERE a.variant_id = v.id)             AS visitors,
              (SELECT COUNT(DISTINCT e.visitor_id)
                 FROM events e
                WHERE e.variant_id = v.id
                  AND e.name = ?)                      AS conversions
         FROM variants v
        WHERE v.experiment_id = ?
        ORDER BY v.is_control DESC, v.key`,
    )
    .all(name, experimentId) as OutcomeRow[]

  const outcomes: VariantOutcome[] = rows.map((row) => {
    const counts = { conversions: row.conversions, visitors: row.visitors }
    return {
      variantId: row.variant_id,
      key: row.key,
      isControl: row.is_control === 1,
      visitors: row.visitors,
      conversions: row.conversions,
      rate: rate(counts),
      interval: wilsonInterval(counts),
    }
  })

  const control = outcomes.find((o) => o.isControl) ?? null

  const variants: VariantResult[] = outcomes.map((outcome) => ({
    ...outcome,
    comparison:
      control === null || outcome.variantId === control.variantId
        ? null
        : compareProportions(
            { conversions: control.conversions, visitors: control.visitors },
            { conversions: outcome.conversions, visitors: outcome.visitors },
          ),
  }))

  const totals = variants.reduce(
    (acc, v) => ({
      visitors: acc.visitors + v.visitors,
      conversions: acc.conversions + v.conversions,
      rate: 0,
    }),
    { visitors: 0, conversions: 0, rate: 0 },
  )
  totals.rate = rate(totals)

  // A leader has to beat the control significantly *and* by the largest
  // margin. Ties leave `leader` null rather than picking whichever row the
  // database happened to return first.
  const winners = variants.filter(
    (v) => v.comparison?.significant === true && v.comparison.absoluteDifference > 0,
  )
  let leader: VariantResult | null = null
  if (winners.length > 0) {
    const best = Math.max(...winners.map((v) => v.rate))
    const tied = winners.filter((v) => v.rate === best)
    leader = tied.length === 1 ? tied[0] : null
  }

  return {
    experimentId: experiment.id,
    name: experiment.name,
    status: experiment.status,
    eventName: name,
    variants,
    totals,
    control,
    leader,
  }
}
