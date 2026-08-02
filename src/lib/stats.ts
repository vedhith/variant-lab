/**
 * The statistics behind the results page.
 *
 * An experiment tool that reports "B is winning" off two raw percentages is
 * worse than no tool at all, so the maths lives here, on its own, with no
 * database or HTTP in sight — everything in this file is a pure function of
 * counts, which is what makes it testable against values worked out by hand.
 *
 * The model is the standard one for conversion tests: each variant is a
 * sequence of Bernoulli trials (a visitor either converted or did not), and a
 * variant is compared against the control with a two-proportion test.
 */

/** A closed interval, used for both rate and difference estimates. */
export interface Interval {
  low: number
  high: number
}

/** Counts for one variant: how many visitors saw it, how many converted. */
export interface Proportion {
  conversions: number
  visitors: number
}

/** z for a two-sided 95% interval. */
export const Z_95 = 1.959963984540054

/** Below this p-value a difference is called significant. */
export const SIGNIFICANCE_LEVEL = 0.05

/**
 * Complementary error function.
 *
 * Numerical Recipes' Chebyshev fit — fractional error below 1.2e-7, which is
 * several orders of magnitude tighter than anything a conversion test can
 * resolve, and it avoids pulling in a dependency for one function.
 */
export function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + z / 2)
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    )
  return x >= 0 ? ans : 2 - ans
}

/** P(Z <= z) for a standard normal Z. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2)
}

/** Two-sided p-value for a z statistic. */
export function twoSidedPValue(z: number): number {
  return Math.min(1, erfc(Math.abs(z) / Math.SQRT2))
}

/** Observed conversion rate. Zero visitors is reported as a rate of 0, not NaN. */
export function rate({ conversions, visitors }: Proportion): number {
  return visitors === 0 ? 0 : conversions / visitors
}

/**
 * Wilson score interval for a single variant's conversion rate.
 *
 * Preferred over the textbook normal interval because it stays inside [0, 1]
 * and still says something sensible at the small counts and near-zero rates
 * that a real experiment spends its first day in.
 *
 * Returns null when there are no visitors — there is no interval to report.
 */
export function wilsonInterval(
  { conversions, visitors }: Proportion,
  z: number = Z_95,
): Interval | null {
  if (visitors === 0) return null

  const p = conversions / visitors
  const z2 = z * z
  const denominator = 1 + z2 / visitors
  const center = (p + z2 / (2 * visitors)) / denominator
  const spread =
    (z / denominator) * Math.sqrt((p * (1 - p)) / visitors + z2 / (4 * visitors * visitors))

  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) }
}

/** The outcome of comparing one variant against the control. */
export interface Comparison {
  /** treatment rate − control rate, in percentage points expressed as a fraction. */
  absoluteDifference: number
  /**
   * Relative lift over the control, e.g. 0.2 for "20% better".
   * Null when the control converted nobody — dividing by a zero rate says
   * nothing, and "infinite lift" is a lie a results page should not tell.
   */
  lift: number | null
  /** 95% confidence interval on `absoluteDifference`, or null when undefined. */
  differenceInterval: Interval | null
  /** Two-sided p-value under the null hypothesis that the rates are equal. */
  pValue: number | null
  /** True when `pValue` is below `SIGNIFICANCE_LEVEL`. */
  significant: boolean
}

/**
 * Two-proportion test of a treatment against a control.
 *
 * The p-value uses the pooled standard error (the usual choice when testing
 * the null of equal rates) while the confidence interval uses the unpooled
 * one, since under the alternative the two rates are not assumed equal.
 *
 * Degenerate inputs return nulls rather than NaN or a fake certainty:
 * - either side with no visitors: nothing to compare
 * - both sides all-converting or none-converting: the rates are identical, so
 *   the difference is 0 and the p-value is 1
 */
export function compareProportions(
  control: Proportion,
  treatment: Proportion,
  z: number = Z_95,
): Comparison {
  const controlRate = rate(control)
  const treatmentRate = rate(treatment)
  const absoluteDifference = treatmentRate - controlRate
  const lift = controlRate === 0 ? null : absoluteDifference / controlRate

  if (control.visitors === 0 || treatment.visitors === 0) {
    return {
      absoluteDifference,
      lift,
      differenceInterval: null,
      pValue: null,
      significant: false,
    }
  }

  const pooled =
    (control.conversions + treatment.conversions) / (control.visitors + treatment.visitors)
  const pooledSe = Math.sqrt(
    pooled * (1 - pooled) * (1 / control.visitors + 1 / treatment.visitors),
  )
  // pooledSe is 0 only when every visitor converted or none did, on both
  // sides — in which case the two rates are equal and there is no evidence
  // of a difference at all.
  const pValue = pooledSe === 0 ? 1 : twoSidedPValue(absoluteDifference / pooledSe)

  const unpooledSe = Math.sqrt(
    (controlRate * (1 - controlRate)) / control.visitors +
      (treatmentRate * (1 - treatmentRate)) / treatment.visitors,
  )
  const differenceInterval =
    unpooledSe === 0
      ? null
      : {
          low: absoluteDifference - z * unpooledSe,
          high: absoluteDifference + z * unpooledSe,
        }

  return {
    absoluteDifference,
    lift,
    differenceInterval,
    pValue,
    significant: pValue < SIGNIFICANCE_LEVEL,
  }
}
