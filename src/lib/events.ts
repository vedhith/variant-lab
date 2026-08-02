import type { Db } from './db'
import { NotFoundError, ValidationError, getExperiment } from './experiments'
import { newEventId } from './ids'
import type { Event } from './types'

/**
 * Conversion ingest.
 *
 * An event is only worth storing if it can be attributed to a variant, so
 * recording one requires the visitor to already hold an assignment. The
 * variant is read from that stored assignment rather than recomputed: if the
 * experiment's weights change between the visit and the conversion, the
 * conversion still counts for the variant the visitor was actually shown.
 */

/** The event name recorded when a caller does not specify one. */
export const DEFAULT_EVENT_NAME = 'conversion'

const MAX_EVENT_NAME_LENGTH = 64

export interface NewEventInput {
  experimentId: string
  visitorId: string
  /** Defaults to `conversion`. */
  name?: string
  /** Optional numeric payload — revenue, seconds on page, and so on. */
  value?: number | null
}

interface EventRow {
  id: string
  experiment_id: string
  visitor_id: string
  variant_id: string
  name: string
  value: number | null
  created_at: string
}

function toEvent(row: EventRow): Event {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    visitorId: row.visitor_id,
    variantId: row.variant_id,
    name: row.name,
    value: row.value,
    createdAt: row.created_at,
  }
}

/**
 * Record an event against the visitor's existing assignment.
 *
 * Throws `NotFoundError` if the experiment does not exist, and
 * `ValidationError` if the visitor was never assigned — an unattributable
 * event is a client bug worth surfacing, not a row worth keeping.
 */
export function recordEvent(db: Db, input: NewEventInput): Event {
  const experimentId = (input?.experimentId ?? '').trim()
  if (!experimentId) throw new ValidationError('experimentId is required')

  const visitorId = (input?.visitorId ?? '').trim()
  if (!visitorId) throw new ValidationError('visitorId is required')

  const name = (input?.name ?? DEFAULT_EVENT_NAME).trim() || DEFAULT_EVENT_NAME
  if (name.length > MAX_EVENT_NAME_LENGTH) {
    throw new ValidationError(`name must be at most ${MAX_EVENT_NAME_LENGTH} characters`)
  }

  const rawValue = input?.value
  let value: number | null = null
  if (rawValue !== undefined && rawValue !== null) {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw new ValidationError('value must be a finite number')
    }
    value = rawValue
  }

  // Resolves the experiment first so a bad id reads as 404, not "no assignment".
  getExperiment(db, experimentId)

  const assignment = db
    .prepare('SELECT variant_id FROM assignments WHERE experiment_id = ? AND visitor_id = ?')
    .get(experimentId, visitorId) as { variant_id: string } | undefined

  if (!assignment) {
    throw new ValidationError(
      `visitor "${visitorId}" has no assignment for this experiment — call /api/assign first`,
    )
  }

  const event: Event = {
    id: newEventId(),
    experimentId,
    visitorId,
    variantId: assignment.variant_id,
    name,
    value,
    createdAt: new Date().toISOString(),
  }

  db.prepare(`
    INSERT INTO events (id, experiment_id, visitor_id, variant_id, name, value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.experimentId,
    event.visitorId,
    event.variantId,
    event.name,
    event.value,
    event.createdAt,
  )

  return event
}

/** Every event name seen on an experiment, with how many were recorded. */
export function eventNames(
  db: Db,
  experimentId: string,
): Array<{ name: string; count: number }> {
  return db
    .prepare(
      `SELECT name, COUNT(*) AS count
         FROM events
        WHERE experiment_id = ?
        GROUP BY name
        ORDER BY count DESC, name`,
    )
    .all(experimentId) as Array<{ name: string; count: number }>
}

/** Recent events on an experiment, newest first. */
export function listEvents(db: Db, experimentId: string, limit = 50): Event[] {
  const rows = db
    .prepare(
      'SELECT * FROM events WHERE experiment_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    .all(experimentId, limit) as EventRow[]
  return rows.map(toEvent)
}

export { NotFoundError, ValidationError }
