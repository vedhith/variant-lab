import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '@/lib/db'
import {
  NotFoundError,
  ValidationError,
  assignVisitor,
  createExperiment,
} from '@/lib/experiments'
import { eventNames, listEvents, recordEvent } from '@/lib/events'
import { experimentResults } from '@/lib/results'
import type { ExperimentWithVariants } from '@/lib/types'

let db: Db

beforeEach(() => {
  db = openDatabase(':memory:')
})

function makeExperiment(): ExperimentWithVariants {
  return createExperiment(db, {
    name: 'Pricing headline',
    baselineHtml: '<h1>Ship faster</h1>',
    status: 'running',
    variants: [
      { key: 'control', html: '<h1>Ship faster</h1>', isControl: true },
      { key: 'b', html: '<h1>Ship on Friday</h1>' },
    ],
  })
}

/**
 * Assign `count` visitors and hand back who landed where.
 *
 * Bucketing is deterministic, so which visitor gets which variant is not ours
 * to choose — the tests read the split back and then convert a share of each
 * group, which is also how a real experiment works.
 */
function assignMany(experimentId: string, count: number): Map<string, string[]> {
  const byVariant = new Map<string, string[]>()
  for (let i = 0; i < count; i++) {
    const visitorId = `visitor-${i}`
    const { variant } = assignVisitor(db, experimentId, visitorId)
    const bucket = byVariant.get(variant.id) ?? []
    bucket.push(visitorId)
    byVariant.set(variant.id, bucket)
  }
  return byVariant
}

/** Convert the first `n` visitors of a group. */
function convert(experimentId: string, visitors: string[], n: number, name?: string): void {
  for (const visitorId of visitors.slice(0, n)) {
    recordEvent(db, { experimentId, visitorId, name })
  }
}

describe('recordEvent', () => {
  it('attributes an event to the visitor’s assigned variant', () => {
    const experiment = makeExperiment()
    const { variant } = assignVisitor(db, experiment.id, 'visitor-1')

    const event = recordEvent(db, { experimentId: experiment.id, visitorId: 'visitor-1' })

    expect(event.id).toMatch(/^evt_/)
    expect(event.variantId).toBe(variant.id)
    expect(event.name).toBe('conversion')
    expect(event.value).toBeNull()
    expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps a numeric value when one is given', () => {
    const experiment = makeExperiment()
    assignVisitor(db, experiment.id, 'visitor-1')
    const event = recordEvent(db, {
      experimentId: experiment.id,
      visitorId: 'visitor-1',
      name: 'purchase',
      value: 49.5,
    })
    expect(event.name).toBe('purchase')
    expect(event.value).toBe(49.5)
  })

  it('rejects an event from a visitor who was never assigned', () => {
    const experiment = makeExperiment()
    expect(() =>
      recordEvent(db, { experimentId: experiment.id, visitorId: 'stranger' }),
    ).toThrow(ValidationError)
  })

  it('rejects an unknown experiment as not found', () => {
    expect(() => recordEvent(db, { experimentId: 'exp_nope', visitorId: 'v' })).toThrow(
      NotFoundError,
    )
  })

  it('rejects missing ids and non-finite values', () => {
    const experiment = makeExperiment()
    assignVisitor(db, experiment.id, 'visitor-1')

    expect(() => recordEvent(db, { experimentId: '', visitorId: 'visitor-1' })).toThrow(
      ValidationError,
    )
    expect(() => recordEvent(db, { experimentId: experiment.id, visitorId: '  ' })).toThrow(
      ValidationError,
    )
    expect(() =>
      recordEvent(db, {
        experimentId: experiment.id,
        visitorId: 'visitor-1',
        value: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(ValidationError)
    expect(() =>
      recordEvent(db, {
        experimentId: experiment.id,
        visitorId: 'visitor-1',
        value: 'lots' as unknown as number,
      }),
    ).toThrow(ValidationError)
  })

  it('sticks with the variant the visitor was shown, not a recomputed one', () => {
    const experiment = makeExperiment()
    const { variant } = assignVisitor(db, experiment.id, 'visitor-1')

    // Send all future traffic elsewhere. The visitor already saw `variant`, so
    // their conversion has to keep counting for it.
    db.prepare('UPDATE variants SET weight = 0 WHERE id = ?').run(variant.id)

    const event = recordEvent(db, { experimentId: experiment.id, visitorId: 'visitor-1' })
    expect(event.variantId).toBe(variant.id)
  })

  it('lists recent events and the names in use', () => {
    const experiment = makeExperiment()
    assignVisitor(db, experiment.id, 'visitor-1')
    recordEvent(db, { experimentId: experiment.id, visitorId: 'visitor-1' })
    recordEvent(db, { experimentId: experiment.id, visitorId: 'visitor-1' })
    recordEvent(db, { experimentId: experiment.id, visitorId: 'visitor-1', name: 'signup' })

    expect(listEvents(db, experiment.id)).toHaveLength(3)
    expect(eventNames(db, experiment.id)).toEqual([
      { name: 'conversion', count: 2 },
      { name: 'signup', count: 1 },
    ])
  })
})

describe('experimentResults', () => {
  it('reports zeros, not NaN, before any traffic arrives', () => {
    const experiment = makeExperiment()
    const results = experimentResults(db, experiment.id)

    expect(results.totals).toEqual({ visitors: 0, conversions: 0, rate: 0 })
    expect(results.variants).toHaveLength(2)
    expect(results.leader).toBeNull()
    for (const variant of results.variants) {
      expect(variant.rate).toBe(0)
      expect(variant.interval).toBeNull()
      expect(variant.comparison?.pValue ?? null).toBeNull()
    }
  })

  it('puts the control first and marks it as having no comparison', () => {
    const experiment = makeExperiment()
    const results = experimentResults(db, experiment.id)

    expect(results.variants[0].isControl).toBe(true)
    expect(results.variants[0].comparison).toBeNull()
    expect(results.control?.key).toBe('control')
    expect(results.variants[1].comparison).not.toBeNull()
  })

  it('counts a repeat converter once', () => {
    const experiment = makeExperiment()
    const { variant } = assignVisitor(db, experiment.id, 'visitor-1')
    for (let i = 0; i < 5; i++) {
      recordEvent(db, { experimentId: experiment.id, visitorId: 'visitor-1' })
    }

    const results = experimentResults(db, experiment.id)
    const row = results.variants.find((v) => v.variantId === variant.id)!

    expect(listEvents(db, experiment.id)).toHaveLength(5)
    expect(row.conversions).toBe(1)
    expect(row.visitors).toBe(1)
    expect(row.rate).toBe(1)
    expect(results.totals.conversions).toBe(1)
  })

  it('counts only the event name being asked about', () => {
    const experiment = makeExperiment()
    assignVisitor(db, experiment.id, 'visitor-1')
    recordEvent(db, { experimentId: experiment.id, visitorId: 'visitor-1', name: 'signup' })

    expect(experimentResults(db, experiment.id, 'conversion').totals.conversions).toBe(0)
    expect(experimentResults(db, experiment.id, 'signup').totals.conversions).toBe(1)
    expect(experimentResults(db, experiment.id, '   ').eventName).toBe('conversion')
  })

  it('keeps each variant’s conversions to its own visitors', () => {
    const experiment = makeExperiment()
    const groups = assignMany(experiment.id, 200)
    const [firstId, secondId] = [...groups.keys()]

    convert(experiment.id, groups.get(firstId)!, 7)

    const results = experimentResults(db, experiment.id)
    expect(results.variants.find((v) => v.variantId === firstId)!.conversions).toBe(7)
    expect(results.variants.find((v) => v.variantId === secondId)!.conversions).toBe(0)
    expect(results.totals.visitors).toBe(200)
    expect(results.totals.conversions).toBe(7)
  })

  it('names a leader when a variant clearly beats the control', () => {
    const experiment = makeExperiment()
    const groups = assignMany(experiment.id, 600)
    const results0 = experimentResults(db, experiment.id)
    const controlId = results0.control!.variantId
    const challengerId = results0.variants.find((v) => !v.isControl)!.variantId

    const controlVisitors = groups.get(controlId)!
    const challengerVisitors = groups.get(challengerId)!
    convert(experiment.id, controlVisitors, Math.round(controlVisitors.length * 0.1))
    convert(experiment.id, challengerVisitors, Math.round(challengerVisitors.length * 0.3))

    const results = experimentResults(db, experiment.id)
    const challenger = results.variants.find((v) => v.variantId === challengerId)!

    expect(challenger.comparison!.significant).toBe(true)
    expect(challenger.comparison!.absoluteDifference).toBeGreaterThan(0)
    expect(challenger.comparison!.lift).toBeGreaterThan(1.5)
    expect(results.leader?.variantId).toBe(challengerId)
    expect(challenger.interval!.low).toBeLessThan(challenger.rate)
    expect(challenger.interval!.high).toBeGreaterThan(challenger.rate)
  })

  it('names no leader when the variants are tied', () => {
    const experiment = makeExperiment()
    const groups = assignMany(experiment.id, 400)
    for (const visitors of groups.values()) {
      convert(experiment.id, visitors, Math.round(visitors.length * 0.2))
    }

    const results = experimentResults(db, experiment.id)
    expect(results.leader).toBeNull()
    for (const variant of results.variants.filter((v) => !v.isControl)) {
      expect(variant.comparison!.significant).toBe(false)
    }
  })

  it('names no leader when a variant is merely ahead but not significantly', () => {
    const experiment = makeExperiment()
    const groups = assignMany(experiment.id, 60)
    const results0 = experimentResults(db, experiment.id)
    const controlId = results0.control!.variantId

    for (const [variantId, visitors] of groups) {
      convert(experiment.id, visitors, variantId === controlId ? 3 : 5)
    }

    const results = experimentResults(db, experiment.id)
    expect(results.leader).toBeNull()
  })

  it('handles a single-variant experiment without inventing a comparison', () => {
    const experiment = createExperiment(db, {
      name: 'Solo',
      baselineHtml: '<h1>Only</h1>',
      variants: [
        { key: 'control', html: '<h1>Only</h1>', isControl: true },
        { key: 'b', html: '<h1>Other</h1>', weight: 0 },
      ],
    })
    // Every visitor lands on the control, since the other variant has no weight.
    assignMany(experiment.id, 20)
    const results = experimentResults(db, experiment.id)

    expect(results.control!.visitors).toBe(20)
    const idle = results.variants.find((v) => !v.isControl)!
    expect(idle.visitors).toBe(0)
    expect(idle.comparison!.pValue).toBeNull()
    expect(results.leader).toBeNull()
  })

  it('throws for an unknown experiment', () => {
    expect(() => experimentResults(db, 'exp_nope')).toThrow(NotFoundError)
  })
})
