/**
 * Public-demo mode: the switches that make a shared instance safe to hand to a
 * stranger.
 *
 * Variant Lab has no accounts, so every default in it assumes the only person
 * who can reach the server is the person who started it. That assumption is
 * fine on a laptop and false the moment there is a deploy button in the
 * README. Rather than quietly hoping nobody notices, `VARIANT_LAB_DEMO=1`
 * turns off the two things that stop being reasonable when the audience is the
 * open internet:
 *
 * 1. **Importing a URL.** `/api/import` makes *this server* fetch an address
 *    someone else chose. The guard in `importing/target.ts` refuses private
 *    addresses and re-checks every redirect, but it documents its own hole (a
 *    DNS rebinding race), and a hosted box is exactly where that hole is worth
 *    something — the metadata service lives at a private address one successful
 *    race away. On your own machine the guard is the honest 95%; pointed at
 *    the public internet it is a bet, and the demo does not take it.
 *
 * 2. **Unbounded growth.** Anyone can create an experiment, each carrying up
 *    to 512 KB of HTML per variant. A shared instance fills its disk in an
 *    afternoon if someone is bored. The cap turns that from an outage into a
 *    403 that tells you to clone the repo.
 *
 * What stays on is deliberate: reading experiments, creating them, generating
 * variants with the offline rules, assignment, and conversion events. Those
 * are the parts worth showing, and none of them lets a visitor reach past the
 * app — variant HTML is rendered inside a `<pre>`, so it is escaped rather
 * than executed, and generation with no `ANTHROPIC_API_KEY` spends no money.
 *
 * The flag is off by default. A clone stays the unrestricted tool it is.
 */

import type { Db } from './db'
import { countExperiments } from './experiments'

/**
 * Thrown when a feature exists but is turned off on this instance — surfaces
 * as a 403 at the API edge.
 *
 * Deliberately not a `ValidationError`: there is nothing wrong with the
 * request, and the same call against a local clone would succeed. Telling
 * those apart is the difference between "fix your JSON" and "run this
 * yourself".
 */
export class DisabledError extends Error {}

export type HostingEnv = Record<string, string | undefined>

/** Experiments a demo instance will hold before it stops accepting more. */
export const DEFAULT_EXPERIMENT_LIMIT = 200

/** True when this instance is the shared public demo rather than someone's clone. */
export function isPublicDemo(env: HostingEnv = process.env): boolean {
  const flag = env.VARIANT_LAB_DEMO?.trim().toLowerCase()
  return flag === '1' || flag === 'true'
}

/**
 * How many experiments this instance will hold, or `null` for no limit.
 *
 * A value that is not a non-negative integer falls back to the default rather
 * than being treated as "unlimited". Both directions of a typo are possible
 * and only one of them is safe: `VARIANT_LAB_DEMO_MAX_EXPERIMENTS=twenty`
 * should not quietly uncap a public box. `0` is a real answer — a demo that
 * serves the seeded experiments and accepts nothing new.
 */
export function experimentLimit(env: HostingEnv = process.env): number | null {
  if (!isPublicDemo(env)) return null

  const raw = env.VARIANT_LAB_DEMO_MAX_EXPERIMENTS?.trim()
  if (!raw) return DEFAULT_EXPERIMENT_LIMIT

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_EXPERIMENT_LIMIT
  return parsed
}

/** Refuse `/api/import` on a shared instance. See the note at the top of this file. */
export function assertImportAllowed(env: HostingEnv = process.env): void {
  if (!isPublicDemo(env)) return
  throw new DisabledError(
    'importing a URL is turned off on the shared demo, because it would make this ' +
      'server fetch whatever address a stranger names. Clone the repo and run it ' +
      'locally to import a live page, or paste the HTML instead.',
  )
}

/** Refuse a new experiment once a shared instance has as many as it will hold. */
export function assertRoomForExperiment(db: Db, env: HostingEnv = process.env): void {
  const limit = experimentLimit(env)
  if (limit === null) return

  const count = countExperiments(db)
  if (count >= limit) {
    throw new DisabledError(
      `the shared demo holds ${limit} experiments and is full, so it is not ` +
        'accepting new ones. Clone the repo to run your own with no limit.',
    )
  }
}
