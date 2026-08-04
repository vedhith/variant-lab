import { assignVariant, hashToUnitInterval } from './bucketing'
import type { Db } from './db'
import { DEFAULT_EVENT_NAME, recordEvent } from './events'
import { assignVisitor, createExperiment } from './experiments'
import type { ExperimentStatus, ExperimentWithVariants } from './types'

/**
 * The seeded demo.
 *
 * A stranger who clones this repo has no traffic, so every page they open is
 * empty and the interesting parts — lift, confidence, a leader that refuses to
 * be named — never appear. `npm run seed` fills that gap with four experiments
 * that between them cover the states a results page actually has to survive: a
 * clear winner next to a clear loser, a difference too small to call, an exact
 * tie, a variant nobody has seen, and an experiment with no traffic at all.
 *
 * Two properties make this a demo rather than a fixture dump:
 *
 * 1. **It goes through the real code.** Visitors are assigned with
 *    `assignVisitor` and conversions recorded with `recordEvent`, so the seeded
 *    numbers are produced by the same functions a live install uses. Inserting
 *    rows straight into the tables would let the demo keep working after the
 *    real path broke.
 * 2. **It is reproducible.** Ids are fixed, and both the split and the
 *    conversions come from hashing rather than `Math.random`, so seeding twice
 *    gives byte-identical counts and the demo URLs never change. The published
 *    numbers below are therefore facts about this seed, not a lucky run.
 */

/** Probability draws are hashes, so the whole demo is a pure function of its ids. */
function draw(namespace: string, experimentId: string, visitorId: string): number {
  return hashToUnitInterval(`demo:${namespace}:${experimentId}:${visitorId}`)
}

export interface DemoVariantSpec {
  key: string
  html: string
  /** Relative traffic weight. 0 means paused — it gets no visitors at all. */
  weight?: number
  isControl?: boolean
  /** The probability a visitor on this variant converts. */
  rate: number
}

/**
 * How traffic is simulated.
 *
 * `hashed` is the realistic one: visitors arrive, get bucketed by hash, and
 * convert on a draw. The split lands near the target without hitting it
 * exactly, which is what a real experiment looks like.
 *
 * `balanced` exists for one job — constructing an *exact* tie. Equal rates
 * need equal counts on both sides, and hashed traffic will not hand you those,
 * so this mode recruits a fixed quota per variant and converts a fixed number
 * of them. It is stated here rather than hidden because a tie this clean is
 * built, not observed.
 */
export type DemoTraffic =
  | { kind: 'hashed'; visitors: number }
  | { kind: 'balanced'; visitorsPerVariant: number; conversionsPerVariant: number }

export interface DemoScenario {
  /** Fixed, so the URLs in the README stay valid across re-seeds. */
  id: string
  name: string
  /** What this experiment is here to show. Printed by the seed script. */
  shows: string
  status: ExperimentStatus
  baselineHtml: string
  variants: DemoVariantSpec[]
  traffic: DemoTraffic
  /**
   * A second event name, recorded for converters who also pass this draw.
   * Gives the results page's event switcher something to switch to.
   */
  secondaryEvent?: { name: string; rate: number }
}

const PRICING_BASELINE = `<section class="hero">
  <h1>Powerful invoicing software for growing teams</h1>
  <p>Everything you need to bill customers, all in one incredibly simple place.</p>
  <a class="cta" href="/signup">Learn more</a>
</section>`

const SIGNUP_BASELINE = `<form class="signup">
  <h2>Create your account</h2>
  <input name="email" placeholder="you@company.com" />
  <button type="submit">Submit</button>
</form>`

const DOCS_BASELINE = `<section class="docs-cta">
  <h2>Read the documentation</h2>
  <a href="/docs">Documentation</a>
</section>`

const BLOG_BASELINE = `<aside class="subscribe">
  <h3>Get the newsletter</h3>
  <a href="/subscribe">Sign up</a>
</aside>`

/**
 * The four seeded experiments.
 *
 * Rates are chosen so the verdicts are unambiguous at the traffic given —
 * `tests/demo.test.ts` pins the resulting counts, so a change here that made
 * the demo tell a different story would fail the suite rather than quietly
 * ship a results page that says something else.
 */
export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'exp_demo_pricing',
    name: 'Pricing page — headline and CTA',
    shows: 'a winner, a loser, and a paused variant nobody has seen',
    status: 'running',
    baselineHtml: PRICING_BASELINE,
    traffic: { kind: 'hashed', visitors: 2400 },
    secondaryEvent: { name: 'purchase', rate: 0.45 },
    variants: [
      {
        key: 'control',
        isControl: true,
        rate: 0.08,
        html: PRICING_BASELINE,
      },
      {
        key: 'b',
        rate: 0.125,
        html: `<section class="hero">
  <h1>Invoicing for growing teams</h1>
  <p>Everything you need to bill customers, in one place.</p>
  <a class="cta" href="/signup">See a live invoice</a>
</section>`,
      },
      {
        key: 'c',
        rate: 0.042,
        html: `<section class="hero">
  <h1>Should billing really take all afternoon?</h1>
  <p>Everything you need to bill customers, all in one incredibly simple place.</p>
  <a class="cta" href="/signup">Learn more</a>
</section>`,
      },
      {
        key: 'd',
        weight: 0,
        rate: 0.1,
        html: `<section class="hero">
  <h1>Invoicing that closes the month for you</h1>
  <p>Bill customers, chase the late ones, and hand accounting a clean ledger.</p>
  <a class="cta" href="/signup">Start free</a>
</section>`,
      },
    ],
  },
  {
    id: 'exp_demo_signup',
    name: 'Signup form — button copy',
    shows: 'a real difference that has not separated from noise yet',
    status: 'running',
    baselineHtml: SIGNUP_BASELINE,
    traffic: { kind: 'hashed', visitors: 260 },
    variants: [
      { key: 'control', isControl: true, rate: 0.11, html: SIGNUP_BASELINE },
      {
        key: 'b',
        rate: 0.13,
        html: `<form class="signup">
  <h2>Create your account</h2>
  <input name="email" placeholder="you@company.com" />
  <button type="submit">Create my account</button>
</form>`,
      },
    ],
  },
  {
    id: 'exp_demo_docs',
    name: 'Docs landing — an exact tie',
    shows: 'identical rates: p = 1, no winner named',
    status: 'running',
    baselineHtml: DOCS_BASELINE,
    traffic: { kind: 'balanced', visitorsPerVariant: 60, conversionsPerVariant: 15 },
    variants: [
      { key: 'control', isControl: true, rate: 0.25, html: DOCS_BASELINE },
      {
        key: 'b',
        rate: 0.25,
        html: `<section class="docs-cta">
  <h2>Read the documentation</h2>
  <a href="/docs">Browse the docs</a>
</section>`,
      },
    ],
  },
  {
    id: 'exp_demo_blog',
    name: 'Blog CTA — no traffic yet',
    shows: 'a freshly created experiment before its first visitor',
    status: 'draft',
    baselineHtml: BLOG_BASELINE,
    traffic: { kind: 'hashed', visitors: 0 },
    variants: [
      { key: 'control', isControl: true, rate: 0.06, html: BLOG_BASELINE },
      {
        key: 'b',
        rate: 0.09,
        html: `<aside class="subscribe">
  <h3>Get the newsletter</h3>
  <a href="/subscribe">Get next week's issue</a>
</aside>`,
      },
    ],
  },
]

export const DEMO_EXPERIMENT_IDS: readonly string[] = DEMO_SCENARIOS.map((s) => s.id)

/** Every visitor this scenario would ever mint, in order. */
function visitorId(scenarioId: string, index: number): string {
  return `${scenarioId.replace(/^exp_/, '')}-visitor-${index}`
}

/**
 * One in every `DOUBLE_FIRE_EVERY` converters fires the event twice.
 *
 * The demo should show the counting rule, not just claim it: those extra rows
 * push the event count above the conversion count while every rate stays put,
 * because a conversion counts a visitor once.
 */
const DOUBLE_FIRE_EVERY = 17

export interface SeededExperiment {
  id: string
  name: string
  shows: string
  visitors: number
  conversions: number
  events: number
}

function variantIdFor(scenarioId: string, key: string): string {
  return `var_${scenarioId.replace(/^exp_/, '')}_${key}`
}

function insertScenario(db: Db, scenario: DemoScenario): ExperimentWithVariants {
  const variantIds: Record<string, string> = {}
  for (const variant of scenario.variants) {
    variantIds[variant.key] = variantIdFor(scenario.id, variant.key)
  }

  return createExperiment(
    db,
    {
      name: scenario.name,
      baselineHtml: scenario.baselineHtml,
      status: scenario.status,
      variants: scenario.variants.map((v) => ({
        key: v.key,
        html: v.html,
        weight: v.weight ?? 1,
        isControl: v.isControl === true,
      })),
    },
    { id: scenario.id, variantIds },
  )
}

/**
 * Hashed traffic: visitors arrive in order, get bucketed, and convert on a draw
 * against their own variant's rate. The draw is per visitor rather than per
 * (visitor, variant), which is the potential-outcomes framing — the same person
 * has one propensity to convert, and the variant sets the bar it has to clear.
 */
function runHashedTraffic(
  db: Db,
  scenario: DemoScenario,
  experiment: ExperimentWithVariants,
  visitors: number,
): SeededExperiment {
  const rateByVariantId = new Map<string, number>()
  for (const spec of scenario.variants) {
    rateByVariantId.set(variantIdFor(scenario.id, spec.key), spec.rate)
  }

  let conversions = 0
  let events = 0

  db.transaction(() => {
    for (let i = 1; i <= visitors; i += 1) {
      const visitor = visitorId(scenario.id, i)
      const { variant } = assignVisitor(db, experiment.id, visitor)

      const rate = rateByVariantId.get(variant.id) ?? 0
      if (draw(DEFAULT_EVENT_NAME, experiment.id, visitor) >= rate) continue

      recordEvent(db, { experimentId: experiment.id, visitorId: visitor })
      conversions += 1
      events += 1

      if (conversions % DOUBLE_FIRE_EVERY === 0) {
        recordEvent(db, { experimentId: experiment.id, visitorId: visitor })
        events += 1
      }

      const secondary = scenario.secondaryEvent
      if (secondary && draw(secondary.name, experiment.id, visitor) < secondary.rate) {
        recordEvent(db, {
          experimentId: experiment.id,
          visitorId: visitor,
          name: secondary.name,
        })
        events += 1
      }
    }
  })()

  return {
    id: scenario.id,
    name: scenario.name,
    shows: scenario.shows,
    visitors,
    conversions,
    events,
  }
}

/** Raised when a balanced scenario cannot fill its quotas — a config bug, not bad luck. */
export class DemoSeedError extends Error {}

/**
 * Balanced traffic, used only to build the exact tie.
 *
 * Visitor ids are still bucketed by the real hash; the scenario simply keeps
 * minting them until every variant has its quota, skipping any visitor whose
 * variant is already full. So assignment is real, the *sample* is constructed,
 * and the two sides end up with identical denominators.
 */
function runBalancedTraffic(
  db: Db,
  scenario: DemoScenario,
  experiment: ExperimentWithVariants,
  visitorsPerVariant: number,
  conversionsPerVariant: number,
): SeededExperiment {
  if (conversionsPerVariant > visitorsPerVariant) {
    throw new DemoSeedError(
      `${scenario.id}: cannot convert ${conversionsPerVariant} of ${visitorsPerVariant} visitors`,
    )
  }

  const eligible = experiment.variants.filter((v) => v.weight > 0)
  const recruited = new Map<string, string[]>(eligible.map((v) => [v.id, []]))
  const wanted = eligible.length * visitorsPerVariant
  // Generous ceiling on how many ids to try: uneven hashing means the last
  // variant's quota fills long after the first's.
  const ceiling = Math.max(1000, wanted * 40)

  let taken = 0
  let events = 0

  db.transaction(() => {
    for (let i = 1; i <= ceiling && taken < wanted; i += 1) {
      const visitor = visitorId(scenario.id, i)
      const target = assignVariant(experiment.id, visitor, eligible)
      const bucket = recruited.get(target.id)
      if (!bucket || bucket.length >= visitorsPerVariant) continue

      assignVisitor(db, experiment.id, visitor)
      bucket.push(visitor)
      taken += 1
    }

    if (taken < wanted) {
      throw new DemoSeedError(
        `${scenario.id}: only filled ${taken} of ${wanted} slots after ${ceiling} visitors`,
      )
    }

    for (const visitors of recruited.values()) {
      for (const visitor of visitors.slice(0, conversionsPerVariant)) {
        recordEvent(db, { experimentId: experiment.id, visitorId: visitor })
        events += 1
      }
    }
  })()

  return {
    id: scenario.id,
    name: scenario.name,
    shows: scenario.shows,
    visitors: wanted,
    conversions: eligible.length * conversionsPerVariant,
    events,
  }
}

/** Delete anything a previous seed created. Cascades to variants, assignments, events. */
export function resetDemo(db: Db): number {
  const statement = db.prepare('DELETE FROM experiments WHERE id = ?')
  let removed = 0
  db.transaction(() => {
    for (const id of DEMO_EXPERIMENT_IDS) removed += statement.run(id).changes
  })()
  return removed
}

/** Which demo experiments are already in this database. */
export function existingDemoIds(db: Db): string[] {
  return DEMO_EXPERIMENT_IDS.filter(
    (id) => db.prepare('SELECT 1 FROM experiments WHERE id = ?').get(id) !== undefined,
  )
}

/**
 * Create the demo experiments and simulate their traffic.
 *
 * Throws `ValidationError` if a demo experiment is already present — pass
 * `reset: true` to replace it. Re-seeding without a reset would either collide
 * on the fixed ids or silently double the traffic on an experiment someone was
 * already reading.
 */
export function seedDemo(db: Db, options: { reset?: boolean } = {}): SeededExperiment[] {
  if (options.reset) resetDemo(db)

  const seeded: SeededExperiment[] = []
  for (const scenario of DEMO_SCENARIOS) {
    const experiment = insertScenario(db, scenario)
    seeded.push(
      scenario.traffic.kind === 'balanced'
        ? runBalancedTraffic(
            db,
            scenario,
            experiment,
            scenario.traffic.visitorsPerVariant,
            scenario.traffic.conversionsPerVariant,
          )
        : runHashedTraffic(db, scenario, experiment, scenario.traffic.visitors),
    )
  }
  return seeded
}
