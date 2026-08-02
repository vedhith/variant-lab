import { describe, expect, it } from 'vitest'
import {
  Z_95,
  compareProportions,
  erfc,
  normalCdf,
  rate,
  twoSidedPValue,
  wilsonInterval,
} from '@/lib/stats'

/**
 * The expected values here are worked out independently of the implementation
 * — standard-normal tables and the published Wilson interval for 10/100 —
 * rather than recorded from a first run. A test that only asserts "whatever it
 * did last time" would happily lock in a wrong answer.
 */

describe('erfc and normalCdf', () => {
  it('matches known values of erfc', () => {
    expect(erfc(0)).toBeCloseTo(1, 6)
    expect(erfc(1)).toBeCloseTo(0.15729920705, 6)
    expect(erfc(-1)).toBeCloseTo(1.84270079295, 6)
    expect(erfc(2)).toBeCloseTo(0.00467773498, 6)
  })

  it('is a proper CDF', () => {
    // 7 decimals, not more: the erfc fit is accurate to ~1.2e-7, which is far
    // beyond what any conversion test can resolve but not exact.
    expect(normalCdf(0)).toBeCloseTo(0.5, 7)
    expect(normalCdf(1)).toBeCloseTo(0.8413447461, 6)
    expect(normalCdf(-1)).toBeCloseTo(0.1586552539, 6)
    expect(normalCdf(Z_95)).toBeCloseTo(0.975, 6)
    expect(normalCdf(-Z_95)).toBeCloseTo(0.025, 6)
  })

  it('is symmetric about zero and monotone', () => {
    for (const z of [0.25, 0.8, 1.5, 2.7, 3.9]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 6)
      expect(normalCdf(z)).toBeGreaterThan(normalCdf(z - 0.1))
    }
  })

  it('gives 5% two-sided at the 95% critical value', () => {
    expect(twoSidedPValue(Z_95)).toBeCloseTo(0.05, 6)
    expect(twoSidedPValue(0)).toBeCloseTo(1, 9)
    expect(twoSidedPValue(-Z_95)).toBeCloseTo(0.05, 6)
    expect(twoSidedPValue(10)).toBeLessThan(1e-9)
  })
})

describe('rate', () => {
  it('divides, and reports zero visitors as zero rather than NaN', () => {
    expect(rate({ conversions: 3, visitors: 12 })).toBe(0.25)
    expect(rate({ conversions: 0, visitors: 0 })).toBe(0)
  })
})

describe('wilsonInterval', () => {
  it('matches the published interval for 10 of 100', () => {
    const interval = wilsonInterval({ conversions: 10, visitors: 100 })
    expect(interval).not.toBeNull()
    expect(interval!.low).toBeCloseTo(0.05523, 4)
    expect(interval!.high).toBeCloseTo(0.17437, 4)
  })

  it('stays inside [0, 1] at the extremes, where a normal interval would not', () => {
    const none = wilsonInterval({ conversions: 0, visitors: 20 })!
    expect(none.low).toBe(0)
    expect(none.high).toBeGreaterThan(0)
    expect(none.high).toBeLessThan(1)

    const all = wilsonInterval({ conversions: 20, visitors: 20 })!
    expect(all.high).toBe(1)
    expect(all.low).toBeLessThan(1)
    expect(all.low).toBeGreaterThan(0)
  })

  it('narrows as the sample grows', () => {
    const small = wilsonInterval({ conversions: 10, visitors: 100 })!
    const large = wilsonInterval({ conversions: 1000, visitors: 10_000 })!
    expect(large.high - large.low).toBeLessThan(small.high - small.low)
  })

  it('has no interval without visitors', () => {
    expect(wilsonInterval({ conversions: 0, visitors: 0 })).toBeNull()
  })
})

describe('compareProportions', () => {
  const control = { conversions: 10, visitors: 100 }
  const treatment = { conversions: 20, visitors: 100 }

  it('reports absolute difference, relative lift, and a hand-checkable interval', () => {
    const result = compareProportions(control, treatment)

    expect(result.absoluteDifference).toBeCloseTo(0.1, 12)
    expect(result.lift).toBeCloseTo(1, 12)

    // Unpooled SE is exactly 0.05 for these counts, so the interval is
    // 0.10 ± 1.959964 × 0.05.
    expect(result.differenceInterval!.low).toBeCloseTo(0.1 - Z_95 * 0.05, 9)
    expect(result.differenceInterval!.high).toBeCloseTo(0.1 + Z_95 * 0.05, 9)
  })

  it('agrees with the textbook p-value for 10/100 against 20/100', () => {
    const result = compareProportions(control, treatment)
    expect(result.pValue).toBeCloseTo(0.0477, 4)
    expect(result.significant).toBe(true)
  })

  it('is symmetric under swapping control and treatment', () => {
    const forward = compareProportions(control, treatment)
    const backward = compareProportions(treatment, control)

    expect(backward.absoluteDifference).toBeCloseTo(-forward.absoluteDifference, 12)
    expect(backward.pValue!).toBeCloseTo(forward.pValue!, 12)
    expect(backward.lift).toBeCloseTo(-0.5, 12)
  })

  it('finds no significance in a small difference on small traffic', () => {
    const result = compareProportions(
      { conversions: 5, visitors: 50 },
      { conversions: 6, visitors: 50 },
    )
    expect(result.pValue).toBeGreaterThan(0.05)
    expect(result.significant).toBe(false)
  })

  it('grows more confident about the same rates as traffic grows', () => {
    const small = compareProportions(
      { conversions: 10, visitors: 100 },
      { conversions: 13, visitors: 100 },
    )
    const large = compareProportions(
      { conversions: 1000, visitors: 10_000 },
      { conversions: 1300, visitors: 10_000 },
    )
    expect(large.pValue!).toBeLessThan(small.pValue!)
    expect(small.significant).toBe(false)
    expect(large.significant).toBe(true)
  })

  it('calls an exact tie a p-value of 1', () => {
    const result = compareProportions(
      { conversions: 25, visitors: 100 },
      { conversions: 25, visitors: 100 },
    )
    expect(result.absoluteDifference).toBe(0)
    expect(result.lift).toBe(0)
    expect(result.pValue).toBeCloseTo(1, 12)
    expect(result.significant).toBe(false)
  })

  it('refuses to report lift when the control converted nobody', () => {
    const result = compareProportions(
      { conversions: 0, visitors: 100 },
      { conversions: 5, visitors: 100 },
    )
    expect(result.lift).toBeNull()
    expect(result.absoluteDifference).toBeCloseTo(0.05, 12)
    expect(result.pValue).not.toBeNull()
  })

  it('claims nothing when neither side has converted anyone', () => {
    const result = compareProportions(
      { conversions: 0, visitors: 80 },
      { conversions: 0, visitors: 90 },
    )
    expect(result.absoluteDifference).toBe(0)
    expect(result.lift).toBeNull()
    expect(result.pValue).toBe(1)
    expect(result.differenceInterval).toBeNull()
    expect(result.significant).toBe(false)
  })

  it('claims nothing when everyone converted on both sides', () => {
    const result = compareProportions(
      { conversions: 40, visitors: 40 },
      { conversions: 60, visitors: 60 },
    )
    expect(result.pValue).toBe(1)
    expect(result.differenceInterval).toBeNull()
    expect(result.significant).toBe(false)
  })

  it('has nothing to say when a side has no visitors', () => {
    const result = compareProportions(
      { conversions: 0, visitors: 0 },
      { conversions: 3, visitors: 10 },
    )
    expect(result.pValue).toBeNull()
    expect(result.differenceInterval).toBeNull()
    expect(result.significant).toBe(false)
  })

  it('never returns NaN, whatever the counts', () => {
    const cases = [
      [
        { conversions: 0, visitors: 0 },
        { conversions: 0, visitors: 0 },
      ],
      [
        { conversions: 1, visitors: 1 },
        { conversions: 0, visitors: 1 },
      ],
      [
        { conversions: 0, visitors: 1 },
        { conversions: 1, visitors: 1 },
      ],
    ] as const

    for (const [a, b] of cases) {
      const result = compareProportions(a, b)
      expect(Number.isNaN(result.absoluteDifference)).toBe(false)
      expect(result.lift === null || Number.isFinite(result.lift)).toBe(true)
      expect(result.pValue === null || Number.isFinite(result.pValue)).toBe(true)
    }
  })
})
