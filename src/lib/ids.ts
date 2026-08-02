import { randomBytes } from 'node:crypto'

/**
 * Short, URL-safe, prefixed identifiers.
 *
 * Prefixes make ids self-describing in logs and in the assignment API, where
 * an experiment id and a variant id are otherwise easy to swap by mistake.
 */
function newId(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`
}

export const newExperimentId = (): string => newId('exp')
export const newVariantId = (): string => newId('var')
export const newEventId = (): string => newId('evt')

/** Anonymous visitor id, minted by the server when a client arrives without one. */
export const newVisitorId = (): string => newId('vis')
