import { beforeEach, describe, expect, it } from 'vitest'
import { assignVariant } from '@/lib/bucketing'
import { openDatabase, type Db } from '@/lib/db'
import {
  DEMO_EXPERIMENT_IDS,
  DEMO_SCENARIOS,
  existingDemoIds,
  resetDemo,
  seedDemo,
} from '@/lib/demo'
import { ValidationError, getExperiment } from '@/lib/experiments'
import { listEvents } from '@/lib/events'
import { experimentResults } from '@/lib/results'

let db: Db

beforeEach(() => {
  db = openDatabase(':memory:')
})

/**
 * The seeded demo is the first thing a stranger sees, and it is the only part
 * of the app whose *numbers* are a promise: the README quotes them, so a change
 * that quietly moved them would make the README wrong. These tests pin the
 * story each experiment tells, not every digit — the counts are asserted where
 * they are the point (the exact tie), and the verdicts everywhere else.
 */
describe('seedDemo', () => {
  it('creates every scenario at its fixed id', () => {
    const seeded = seedDemo(db)

    expect(seeded.map((s) => s.id)).toEqual([...DEMO_EXPERIMENT_IDS])
    expect(existingDemoIds(db)).toEqual([...DEMO_EXPERIMENT_IDS])

    for (const scenario of DEMO_SCENARIOS) {
      const experiment = getExperiment(db, scenario.id)
      expect(experiment.name).toBe(scenario.name)
      expect(experiment.status).toBe(scenario.status)
      expect(experiment.variants.map((v) => v.key).sort()).toEqual(
        scenario.variants.map((v) => v.key).sort(),
      )
    }
  })

  it('is reproducible — seeding twice gives identical numbers', () => {
    const first = seedDemo(db)
    const firstResults = DEMO_EXPERIMENT_IDS.map((id) => experimentResults(db, id))

    const other = openDatabase(':memory:')
    const second = seedDemo(other)
    const secondResults = DEMO_EXPERIMENT_IDS.map((id) => experimentResults(other, id))

    expect(second).toEqual(first)
    expect(secondResults).toEqual(firstResults)
  })

  it('refuses to seed on top of itself', () => {
    seedDemo(db)
    expect(() => seedDemo(db)).toThrow(ValidationError)
  })

  it('reseeds cleanly with reset, leaving no traffic behind', () => {
    const before = seedDemo(db)
    const after = seedDemo(db, { reset: true })

    expect(after).toEqual(before)
    for (const id of DEMO_EXPERIMENT_IDS) {
      const results = experimentResults(db, id)
      const scenario = DEMO_SCENARIOS.find((s) => s.id === id)!
      const expected = after.find((s) => s.id === id)!
      expect(results.totals.visitors).toBe(expected.visitors)
      expect(scenario.name).toBe(results.name)
    }
  })

  it('removes everything it created', () => {
    seedDemo(db)
    const removed = resetDemo(db)

    expect(removed).toBe(DEMO_EXPERIMENT_IDS.length)
    expect(existingDemoIds(db)).toEqual([])
    // Cascades: no orphaned variants, assignments, or events left behind.
    for (const table of ['variants', 'assignments', 'events']) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      expect(row.n).toBe(0)
    }
  })

  it('assigns every seeded visitor through the real bucketing function', () => {
    seedDemo(db)
    const experiment = getExperiment(db, 'exp_demo_pricing')
    const eligible = experiment.variants.filter((v) => v.weight > 0)

    const rows = db
      .prepare('SELECT visitor_id, variant_id FROM assignments WHERE experiment_id = ?')
      .all(experiment.id) as Array<{ visitor_id: string; variant_id: string }>

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.variant_id).toBe(assignVariant(experiment.id, row.visitor_id, eligible).id)
    }
  })
})

describe('the demo covers the states a results page has to survive', () => {
  beforeEach(() => {
    seedDemo(db)
  })

  it('names a leader when one variant genuinely wins', () => {
    const results = experimentResults(db, 'exp_demo_pricing')

    expect(results.leader?.key).toBe('b')
    expect(results.leader!.comparison!.significant).toBe(true)
    expect(results.leader!.comparison!.absoluteDifference!).toBeGreaterThan(0)
    expect(results.leader!.comparison!.pValue!).toBeLessThan(0.01)
  })

  it('shows a significant loser alongside the winner', () => {
    const results = experimentResults(db, 'exp_demo_pricing')
    const loser = results.variants.find((v) => v.key === 'c')!

    expect(loser.comparison!.significant).toBe(true)
    expect(loser.comparison!.absoluteDifference!).toBeLessThan(0)
  })

  it('claims nothing at all about the paused variant', () => {
    const results = experimentResults(db, 'exp_demo_pricing')
    const paused = results.variants.find((v) => v.key === 'd')!

    expect(paused.visitors).toBe(0)
    expect(paused.conversions).toBe(0)
    expect(paused.interval).toBeNull()
    expect(paused.comparison!.absoluteDifference).toBeNull()
    expect(paused.comparison!.lift).toBeNull()
    expect(paused.comparison!.pValue).toBeNull()
    expect(paused.comparison!.significant).toBe(false)
  })

  it('counts a repeat converter once, however many events they fire', () => {
    const results = experimentResults(db, 'exp_demo_pricing')
    const events = listEvents(db, 'exp_demo_pricing', 10_000).filter(
      (e) => e.name === 'conversion',
    )
    const distinctConverters = new Set(events.map((e) => e.visitorId)).size

    // More conversion events than converters: the demo fires some twice on
    // purpose, and the rate must not move because of it.
    expect(events.length).toBeGreaterThan(distinctConverters)
    expect(results.totals.conversions).toBe(distinctConverters)
    for (const variant of results.variants) {
      expect(variant.conversions).toBeLessThanOrEqual(variant.visitors)
    }
  })

  it('records a second event name for the switcher to switch to', () => {
    const purchases = experimentResults(db, 'exp_demo_pricing', 'purchase')

    expect(purchases.eventName).toBe('purchase')
    expect(purchases.totals.conversions).toBeGreaterThan(0)
    // A purchase is a subset of the conversions, so it cannot outnumber them.
    const conversions = experimentResults(db, 'exp_demo_pricing')
    expect(purchases.totals.conversions).toBeLessThan(conversions.totals.conversions)
  })

  it('refuses to name a winner when the difference is small', () => {
    const results = experimentResults(db, 'exp_demo_signup')

    expect(results.totals.visitors).toBeGreaterThan(0)
    expect(results.leader).toBeNull()
    const challenger = results.variants.find((v) => v.key === 'b')!
    expect(challenger.comparison!.significant).toBe(false)
    expect(challenger.comparison!.pValue!).toBeGreaterThan(0.05)
  })

  it('builds an exact tie: identical rates, p = 1, no winner', () => {
    const results = experimentResults(db, 'exp_demo_docs')
    const control = results.variants.find((v) => v.isControl)!
    const challenger = results.variants.find((v) => v.key === 'b')!

    expect(control.visitors).toBe(60)
    expect(challenger.visitors).toBe(60)
    expect(control.conversions).toBe(15)
    expect(challenger.conversions).toBe(15)
    expect(challenger.rate).toBe(control.rate)
    expect(challenger.comparison!.absoluteDifference).toBe(0)
    expect(challenger.comparison!.lift).toBe(0)
    expect(challenger.comparison!.pValue).toBeCloseTo(1, 12)
    expect(results.leader).toBeNull()
  })

  it('handles an experiment with no traffic at all', () => {
    const results = experimentResults(db, 'exp_demo_blog')

    expect(results.totals.visitors).toBe(0)
    expect(results.totals.conversions).toBe(0)
    expect(results.totals.rate).toBe(0)
    expect(results.leader).toBeNull()
    for (const variant of results.variants) {
      expect(variant.interval).toBeNull()
      expect(variant.rate).toBe(0)
    }
  })
})
