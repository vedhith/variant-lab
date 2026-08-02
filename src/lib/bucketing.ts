import { createHash } from 'node:crypto'

/**
 * Deterministic traffic splitting.
 *
 * Assignment must be stable: the same visitor on the same experiment always
 * lands on the same variant, with no shared state between servers. So instead
 * of drawing a random number we hash `experimentId:visitorId` into the unit
 * interval and read the variant off a cumulative-weight ruler.
 *
 * Persisting the assignment (see `assignments` in the schema) is still worth
 * doing — it is what keeps a visitor put when weights or variants change later.
 */

/** Number of hash bits folded into the bucket value. 2^53 keeps it exact in a double. */
const HASH_BITS = 53n
const HASH_SPACE = Number(1n << HASH_BITS)

/**
 * Hash an arbitrary string to a uniformly distributed float in [0, 1).
 *
 * Uses SHA-256 rather than a cheap non-cryptographic hash: bucketing quality
 * matters more than a few microseconds, and SHA-256 is stable across Node
 * versions and platforms, which a hand-rolled hash is not guaranteed to be.
 */
export function hashToUnitInterval(seed: string): number {
  const digest = createHash('sha256').update(seed, 'utf8').digest()
  // Take the top 53 bits so the result is exactly representable as a double.
  const top64 = digest.readBigUInt64BE(0)
  const top53 = top64 >> (64n - HASH_BITS)
  return Number(top53) / HASH_SPACE
}

/** The subset of a variant that bucketing actually needs. */
export interface Bucketable {
  id: string
  weight: number
}

export class BucketingError extends Error {}

/**
 * Pick a variant for a visitor.
 *
 * Deterministic in `(experimentId, visitorId)` and in the variant list: the
 * same arguments always produce the same answer, on any machine.
 *
 * Variants are sorted by id first so that the caller's array order cannot
 * change who gets what.
 */
export function assignVariant<T extends Bucketable>(
  experimentId: string,
  visitorId: string,
  variants: readonly T[],
): T {
  if (variants.length === 0) {
    throw new BucketingError('cannot assign: experiment has no variants')
  }

  const eligible = variants.filter((v) => v.weight > 0)
  if (eligible.length === 0) {
    throw new BucketingError('cannot assign: every variant has zero weight')
  }

  const ordered = [...eligible].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const totalWeight = ordered.reduce((sum, v) => sum + v.weight, 0)

  const point = hashToUnitInterval(`${experimentId}:${visitorId}`) * totalWeight

  let cumulative = 0
  for (const variant of ordered) {
    cumulative += variant.weight
    if (point < cumulative) return variant
  }

  // Only reachable through floating-point drift at the very top of the range.
  return ordered[ordered.length - 1]
}

/**
 * The share of traffic each variant should receive, as a fraction of 1.
 * Handy for the UI and for asserting against observed splits in tests.
 */
export function expectedShares<T extends Bucketable>(
  variants: readonly T[],
): Map<string, number> {
  const total = variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0)
  const shares = new Map<string, number>()
  for (const v of variants) {
    shares.set(v.id, total === 0 ? 0 : Math.max(0, v.weight) / total)
  }
  return shares
}
