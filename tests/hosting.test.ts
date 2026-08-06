import { afterEach, describe, expect, it } from 'vitest'
import { POST as createExperimentRoute } from '@/app/api/experiments/route'
import { POST as importRoute } from '@/app/api/import/route'
import { getDatabase, openDatabase } from '@/lib/db'
import { countExperiments } from '@/lib/experiments'
import {
  DEFAULT_EXPERIMENT_LIMIT,
  DisabledError,
  assertImportAllowed,
  assertRoomForExperiment,
  experimentLimit,
  isPublicDemo,
} from '@/lib/hosting'

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function experimentBody(name: string) {
  return {
    name,
    baselineHtml: '<h1>Ship faster</h1>',
    status: 'running',
    variants: [
      { key: 'control', html: '<h1>Ship faster</h1>', isControl: true },
      { key: 'b', html: '<h1>Ship on Friday</h1>' },
    ],
  }
}

/**
 * Route tests share one process-wide database for the whole file, so the cap
 * is set relative to what is already stored rather than to an absolute number
 * that would depend on which tests ran first.
 */
function allowMoreExperiments(room: number): void {
  process.env.VARIANT_LAB_DEMO_MAX_EXPERIMENTS = String(countExperiments(getDatabase()) + room)
}

/**
 * The routes read `process.env` directly, which is the point — these exercise
 * the switch the way a deploy sets it, not a parameter only a test ever passes.
 */
afterEach(() => {
  delete process.env.VARIANT_LAB_DEMO
  delete process.env.VARIANT_LAB_DEMO_MAX_EXPERIMENTS
})

describe('isPublicDemo', () => {
  it('is off unless asked for', () => {
    expect(isPublicDemo({})).toBe(false)
    expect(isPublicDemo({ VARIANT_LAB_DEMO: '' })).toBe(false)
    expect(isPublicDemo({ VARIANT_LAB_DEMO: '0' })).toBe(false)
    expect(isPublicDemo({ VARIANT_LAB_DEMO: 'false' })).toBe(false)
    expect(isPublicDemo({ VARIANT_LAB_DEMO: 'no' })).toBe(false)
  })

  it('accepts the two spellings a deploy config actually produces', () => {
    expect(isPublicDemo({ VARIANT_LAB_DEMO: '1' })).toBe(true)
    expect(isPublicDemo({ VARIANT_LAB_DEMO: 'true' })).toBe(true)
    expect(isPublicDemo({ VARIANT_LAB_DEMO: ' TRUE ' })).toBe(true)
  })
})

describe('experimentLimit', () => {
  it('does not limit a normal instance, whatever the max says', () => {
    expect(experimentLimit({})).toBeNull()
    expect(experimentLimit({ VARIANT_LAB_DEMO_MAX_EXPERIMENTS: '5' })).toBeNull()
  })

  it('defaults to the built-in cap on a demo instance', () => {
    expect(experimentLimit({ VARIANT_LAB_DEMO: '1' })).toBe(DEFAULT_EXPERIMENT_LIMIT)
  })

  it('takes an explicit cap, including zero', () => {
    expect(experimentLimit({ VARIANT_LAB_DEMO: '1', VARIANT_LAB_DEMO_MAX_EXPERIMENTS: '5' })).toBe(5)
    expect(experimentLimit({ VARIANT_LAB_DEMO: '1', VARIANT_LAB_DEMO_MAX_EXPERIMENTS: '0' })).toBe(0)
  })

  it('falls back to the default rather than uncapping a public box on a typo', () => {
    for (const bad of ['twenty', '-1', '5.5', 'NaN', 'Infinity', '1e3x']) {
      expect(
        experimentLimit({ VARIANT_LAB_DEMO: '1', VARIANT_LAB_DEMO_MAX_EXPERIMENTS: bad }),
        `"${bad}" should not uncap a public instance`,
      ).toBe(DEFAULT_EXPERIMENT_LIMIT)
    }
  })
})

describe('assertImportAllowed', () => {
  it('allows importing on a clone', () => {
    expect(() => assertImportAllowed({})).not.toThrow()
  })

  it('refuses on a demo instance, and says where to go instead', () => {
    expect(() => assertImportAllowed({ VARIANT_LAB_DEMO: '1' })).toThrow(DisabledError)
    expect(() => assertImportAllowed({ VARIANT_LAB_DEMO: '1' })).toThrow(/clone the repo/i)
  })
})

describe('assertRoomForExperiment', () => {
  it('never refuses on a clone', () => {
    const db = openDatabase(':memory:')
    expect(() => assertRoomForExperiment(db, {})).not.toThrow()
    expect(() =>
      assertRoomForExperiment(db, { VARIANT_LAB_DEMO_MAX_EXPERIMENTS: '0' }),
    ).not.toThrow()
  })

  it('refuses as soon as the instance is at its limit', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      assertRoomForExperiment(db, { VARIANT_LAB_DEMO: '1', VARIANT_LAB_DEMO_MAX_EXPERIMENTS: '0' }),
    ).toThrow(DisabledError)
  })
})

describe('POST /api/import on a demo instance', () => {
  it('answers 403 without fetching anything', async () => {
    process.env.VARIANT_LAB_DEMO = '1'

    // A URL that is a 400 on a clone, because it names a private address.
    // Getting the demo's 403 instead proves the switch is read before the URL
    // is — which is the ordering that keeps the server from making the call.
    const res = await importRoute(post('http://test/api/import', { url: 'http://127.0.0.1/' }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/turned off on the shared demo/i)
  })

  it('leaves importing alone when the flag is off', async () => {
    const res = await importRoute(post('http://test/api/import', { url: 'http://127.0.0.1/' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/experiments on a demo instance', () => {
  it('creates normally while there is room', async () => {
    process.env.VARIANT_LAB_DEMO = '1'
    allowMoreExperiments(1)

    const res = await createExperimentRoute(
      post('http://test/api/experiments', experimentBody('with room')),
    )
    expect(res.status).toBe(201)
  })

  it('answers 403 once it is full, without storing a partial experiment', async () => {
    process.env.VARIANT_LAB_DEMO = '1'
    allowMoreExperiments(1)

    const first = await createExperimentRoute(
      post('http://test/api/experiments', experimentBody('one')),
    )
    expect(first.status).toBe(201)

    const before = countExperiments(getDatabase())
    const second = await createExperimentRoute(
      post('http://test/api/experiments', experimentBody('two')),
    )
    expect(second.status).toBe(403)
    expect((await second.json()).error).toMatch(/full/i)
    expect(countExperiments(getDatabase())).toBe(before)
  })

  it('stops caring the moment the flag comes off', async () => {
    process.env.VARIANT_LAB_DEMO = '1'
    allowMoreExperiments(0)

    const refused = await createExperimentRoute(
      post('http://test/api/experiments', experimentBody('blocked')),
    )
    expect(refused.status).toBe(403)

    delete process.env.VARIANT_LAB_DEMO
    const allowed = await createExperimentRoute(
      post('http://test/api/experiments', experimentBody('allowed')),
    )
    expect(allowed.status).toBe(201)
  })
})
