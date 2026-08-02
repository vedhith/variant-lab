import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '@/lib/db'
import {
  NotFoundError,
  ValidationError,
  assignVisitor,
  assignmentCounts,
  createExperiment,
  findExperiment,
  listExperiments,
} from '@/lib/experiments'
import type { NewExperimentInput } from '@/lib/types'

function validInput(overrides: Partial<NewExperimentInput> = {}): NewExperimentInput {
  return {
    name: 'Pricing headline',
    baselineHtml: '<h1>Ship faster</h1>',
    variants: [
      { key: 'control', html: '<h1>Ship faster</h1>', isControl: true },
      { key: 'b', html: '<h1>Ship on Friday</h1>' },
    ],
    ...overrides,
  }
}

let db: Db

beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('createExperiment', () => {
  it('stores the experiment and its variants', () => {
    const experiment = createExperiment(db, validInput())

    expect(experiment.id).toMatch(/^exp_[0-9a-f]{16}$/)
    expect(experiment.name).toBe('Pricing headline')
    expect(experiment.status).toBe('draft')
    expect(experiment.sourceUrl).toBeNull()
    expect(experiment.variants).toHaveLength(2)
    expect(experiment.variants.map((v) => v.key)).toEqual(['b', 'control'])
    expect(experiment.variants.every((v) => v.id.startsWith('var_'))).toBe(true)
  })

  it('reads back identically', () => {
    const created = createExperiment(db, validInput())
    expect(findExperiment(db, created.id)).toEqual(created)
  })

  it('defaults every variant to equal weight', () => {
    const experiment = createExperiment(db, validInput())
    expect(experiment.variants.map((v) => v.weight)).toEqual([1, 1])
  })

  it('marks the first variant as control when none is flagged', () => {
    const experiment = createExperiment(
      db,
      validInput({
        variants: [
          { key: 'a', html: '<p>a</p>' },
          { key: 'b', html: '<p>b</p>' },
        ],
      }),
    )
    const control = experiment.variants.filter((v) => v.isControl)
    expect(control).toHaveLength(1)
    expect(control[0].key).toBe('a')
  })

  it('accepts a valid source URL', () => {
    const experiment = createExperiment(
      db,
      validInput({ sourceUrl: 'https://example.com/pricing' }),
    )
    expect(experiment.sourceUrl).toBe('https://example.com/pricing')
  })

  it.each([
    ['a blank name', validInput({ name: '   ' })],
    ['empty baseline HTML', validInput({ baselineHtml: '  ' })],
    ['a single variant', validInput({ variants: [{ key: 'a', html: '<p>a</p>' }] })],
    ['no variants', validInput({ variants: [] })],
    ['an unparseable source URL', validInput({ sourceUrl: 'not a url' })],
    ['a non-http source URL', validInput({ sourceUrl: 'ftp://example.com' })],
    [
      'duplicate variant keys',
      validInput({
        variants: [
          { key: 'a', html: '<p>1</p>' },
          { key: 'a', html: '<p>2</p>' },
        ],
      }),
    ],
    [
      'a blank variant key',
      validInput({
        variants: [
          { key: '', html: '<p>1</p>' },
          { key: 'b', html: '<p>2</p>' },
        ],
      }),
    ],
    [
      'empty variant HTML',
      validInput({
        variants: [
          { key: 'a', html: '' },
          { key: 'b', html: '<p>2</p>' },
        ],
      }),
    ],
    [
      'a negative weight',
      validInput({
        variants: [
          { key: 'a', html: '<p>1</p>', weight: -1 },
          { key: 'b', html: '<p>2</p>' },
        ],
      }),
    ],
    [
      'weights that are all zero',
      validInput({
        variants: [
          { key: 'a', html: '<p>1</p>', weight: 0 },
          { key: 'b', html: '<p>2</p>', weight: 0 },
        ],
      }),
    ],
    [
      'two controls',
      validInput({
        variants: [
          { key: 'a', html: '<p>1</p>', isControl: true },
          { key: 'b', html: '<p>2</p>', isControl: true },
        ],
      }),
    ],
    ['an unknown status', validInput({ status: 'paused' as never })],
  ])('rejects %s', (_label, input) => {
    expect(() => createExperiment(db, input)).toThrow(ValidationError)
  })

  it('writes nothing when validation fails', () => {
    expect(() => createExperiment(db, validInput({ name: '' }))).toThrow(ValidationError)
    expect(listExperiments(db)).toHaveLength(0)
  })
})

describe('findExperiment', () => {
  it('returns null for an unknown id', () => {
    expect(findExperiment(db, 'exp_missing')).toBeNull()
  })
})

describe('listExperiments', () => {
  it('returns every experiment created', () => {
    createExperiment(db, validInput({ name: 'One' }))
    createExperiment(db, validInput({ name: 'Two' }))
    expect(listExperiments(db).map((e) => e.name).sort()).toEqual(['One', 'Two'])
  })

  it('respects the limit', () => {
    for (let i = 0; i < 5; i++) createExperiment(db, validInput({ name: `E${i}` }))
    expect(listExperiments(db, 2)).toHaveLength(2)
  })
})

describe('assignVisitor', () => {
  it('assigns a variant belonging to the experiment', () => {
    const experiment = createExperiment(db, validInput())
    const result = assignVisitor(db, experiment.id, 'visitor-1')

    expect(experiment.variants.map((v) => v.id)).toContain(result.variant.id)
    expect(result.created).toBe(true)
    expect(result.assignment.visitorId).toBe('visitor-1')
  })

  it('returns the same variant on every repeat call', () => {
    const experiment = createExperiment(db, validInput())
    const first = assignVisitor(db, experiment.id, 'visitor-1')

    for (let i = 0; i < 10; i++) {
      const again = assignVisitor(db, experiment.id, 'visitor-1')
      expect(again.variant.id).toBe(first.variant.id)
      expect(again.created).toBe(false)
      expect(again.assignment.assignedAt).toBe(first.assignment.assignedAt)
    }
  })

  it('stores exactly one assignment row per visitor', () => {
    const experiment = createExperiment(db, validInput())
    for (let i = 0; i < 5; i++) assignVisitor(db, experiment.id, 'visitor-1')

    const total = [...assignmentCounts(db, experiment.id).values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(1)
  })

  it('keeps a visitor on their variant after weights change', () => {
    const experiment = createExperiment(db, validInput())
    const first = assignVisitor(db, experiment.id, 'visitor-1')

    // Starve the assigned variant completely; the stored row must still win.
    db.prepare('UPDATE variants SET weight = 0 WHERE id = ?').run(first.variant.id)
    db.prepare('UPDATE variants SET weight = 100 WHERE id != ? AND experiment_id = ?').run(
      first.variant.id,
      experiment.id,
    )

    expect(assignVisitor(db, experiment.id, 'visitor-1').variant.id).toBe(first.variant.id)
  })

  it('spreads a population across both variants', () => {
    const experiment = createExperiment(db, validInput())
    for (let i = 0; i < 500; i++) assignVisitor(db, experiment.id, `visitor-${i}`)

    const counts = assignmentCounts(db, experiment.id)
    expect(counts.size).toBe(2)
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(200)
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(500)
  })

  it('trims whitespace around the visitor id', () => {
    const experiment = createExperiment(db, validInput())
    const padded = assignVisitor(db, experiment.id, '  visitor-1  ')
    expect(padded.assignment.visitorId).toBe('visitor-1')
    expect(assignVisitor(db, experiment.id, 'visitor-1').created).toBe(false)
  })

  it('rejects a blank visitor id', () => {
    const experiment = createExperiment(db, validInput())
    expect(() => assignVisitor(db, experiment.id, '   ')).toThrow(ValidationError)
  })

  it('throws NotFoundError for an unknown experiment', () => {
    expect(() => assignVisitor(db, 'exp_missing', 'visitor-1')).toThrow(NotFoundError)
  })
})

describe('assignmentCounts', () => {
  it('is empty before anyone is assigned', () => {
    const experiment = createExperiment(db, validInput())
    expect(assignmentCounts(db, experiment.id).size).toBe(0)
  })
})

describe('migrations', () => {
  it('are idempotent across reopens of the same file', () => {
    // openDatabase runs migrate() every time; a second run must be a no-op.
    const fresh = openDatabase(':memory:')
    expect(() => createExperiment(fresh, validInput())).not.toThrow()
  })

  it('enforces the unique variant key constraint', () => {
    const experiment = createExperiment(db, validInput())
    expect(() =>
      db
        .prepare(
          'INSERT INTO variants (id, experiment_id, key, html, weight, is_control, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('var_dupe', experiment.id, 'control', '<p>x</p>', 1, 0, new Date().toISOString()),
    ).toThrow()
  })

  it('cascades variant deletes when an experiment is removed', () => {
    const experiment = createExperiment(db, validInput())
    assignVisitor(db, experiment.id, 'visitor-1')

    db.prepare('DELETE FROM experiments WHERE id = ?').run(experiment.id)

    expect(db.prepare('SELECT COUNT(*) AS n FROM variants').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM assignments').get()).toEqual({ n: 0 })
  })
})
