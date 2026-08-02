import { describe, expect, it } from 'vitest'
import {
  BucketingError,
  assignVariant,
  expectedShares,
  hashToUnitInterval,
} from '@/lib/bucketing'

const AB = [
  { id: 'var_a', weight: 1 },
  { id: 'var_b', weight: 1 },
]

describe('hashToUnitInterval', () => {
  it('stays inside [0, 1)', () => {
    for (let i = 0; i < 2000; i++) {
      const value = hashToUnitInterval(`seed-${i}`)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is deterministic for the same seed', () => {
    expect(hashToUnitInterval('exp_1:visitor_1')).toBe(hashToUnitInterval('exp_1:visitor_1'))
  })

  it('gives different seeds different values', () => {
    expect(hashToUnitInterval('a')).not.toBe(hashToUnitInterval('b'))
  })

  it('spreads roughly uniformly across deciles', () => {
    const deciles = new Array(10).fill(0)
    const n = 20_000
    for (let i = 0; i < n; i++) {
      deciles[Math.floor(hashToUnitInterval(`visitor-${i}`) * 10)]++
    }
    // Each decile should hold ~10% of the mass; allow generous slack so the
    // test is about "not obviously skewed", not about a specific hash output.
    for (const count of deciles) {
      expect(count / n).toBeGreaterThan(0.085)
      expect(count / n).toBeLessThan(0.115)
    }
  })
})

describe('assignVariant', () => {
  it('returns the same variant for the same visitor every time', () => {
    const first = assignVariant('exp_1', 'visitor_1', AB)
    for (let i = 0; i < 50; i++) {
      expect(assignVariant('exp_1', 'visitor_1', AB).id).toBe(first.id)
    }
  })

  it('ignores the order variants are passed in', () => {
    for (let i = 0; i < 200; i++) {
      const forward = assignVariant('exp_1', `visitor_${i}`, AB)
      const reversed = assignVariant('exp_1', `visitor_${i}`, [...AB].reverse())
      expect(reversed.id).toBe(forward.id)
    }
  })

  it('splits an even experiment close to 50/50', () => {
    let a = 0
    const n = 10_000
    for (let i = 0; i < n; i++) {
      if (assignVariant('exp_split', `visitor_${i}`, AB).id === 'var_a') a++
    }
    expect(a / n).toBeGreaterThan(0.47)
    expect(a / n).toBeLessThan(0.53)
  })

  it('honours uneven weights', () => {
    const weighted = [
      { id: 'var_a', weight: 9 },
      { id: 'var_b', weight: 1 },
    ]
    let a = 0
    const n = 10_000
    for (let i = 0; i < n; i++) {
      if (assignVariant('exp_weighted', `visitor_${i}`, weighted).id === 'var_a') a++
    }
    expect(a / n).toBeGreaterThan(0.87)
    expect(a / n).toBeLessThan(0.93)
  })

  it('never assigns a zero-weight variant', () => {
    const paused = [
      { id: 'var_a', weight: 1 },
      { id: 'var_paused', weight: 0 },
    ]
    for (let i = 0; i < 1000; i++) {
      expect(assignVariant('exp_paused', `visitor_${i}`, paused).id).toBe('var_a')
    }
  })

  it('sends everyone to the only funded variant', () => {
    const single = [{ id: 'var_only', weight: 1 }]
    expect(assignVariant('exp_single', 'anyone', single).id).toBe('var_only')
  })

  it('puts the same visitor in different buckets across experiments', () => {
    // Otherwise a visitor unlucky in one experiment is unlucky in all of them,
    // and the experiments stop being independent.
    let differed = 0
    for (let i = 0; i < 200; i++) {
      const one = assignVariant('exp_one', `visitor_${i}`, AB).id
      const two = assignVariant('exp_two', `visitor_${i}`, AB).id
      if (one !== two) differed++
    }
    expect(differed).toBeGreaterThan(50)
  })

  it('rejects an empty variant list', () => {
    expect(() => assignVariant('exp_1', 'visitor_1', [])).toThrow(BucketingError)
  })

  it('rejects an all-zero-weight experiment', () => {
    expect(() =>
      assignVariant('exp_1', 'visitor_1', [
        { id: 'var_a', weight: 0 },
        { id: 'var_b', weight: 0 },
      ]),
    ).toThrow(BucketingError)
  })
})

describe('expectedShares', () => {
  it('normalises weights to fractions of one', () => {
    const shares = expectedShares([
      { id: 'var_a', weight: 3 },
      { id: 'var_b', weight: 1 },
    ])
    expect(shares.get('var_a')).toBeCloseTo(0.75)
    expect(shares.get('var_b')).toBeCloseTo(0.25)
  })

  it('reports zero for every variant when nothing has weight', () => {
    const shares = expectedShares([{ id: 'var_a', weight: 0 }])
    expect(shares.get('var_a')).toBe(0)
  })
})
