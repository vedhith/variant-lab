import { describe, expect, it } from 'vitest'
import { POST as createExperimentRoute } from '@/app/api/experiments/route'
import { POST as assignRoute } from '@/app/api/assign/route'
import { POST as eventsRoute } from '@/app/api/events/route'
import { GET as resultsRoute } from '@/app/api/experiments/[id]/results/route'

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function createExperiment() {
  const res = await createExperimentRoute(
    post('http://test/api/experiments', {
      name: 'Hero copy',
      baselineHtml: '<h1>Ship faster</h1>',
      status: 'running',
      variants: [
        { key: 'control', html: '<h1>Ship faster</h1>', isControl: true },
        { key: 'b', html: '<h1>Ship on Friday</h1>' },
      ],
    }),
  )
  expect(res.status).toBe(201)
  return (await res.json()).experiment as { id: string }
}

async function assign(experimentId: string, visitorId: string) {
  const res = await assignRoute(
    post('http://test/api/assign', { experimentId, visitorId }),
  )
  expect(res.status).toBe(200)
  return (await res.json()) as { variant: { id: string; key: string } }
}

async function getResults(experimentId: string, query = '') {
  const res = await resultsRoute(
    new Request(`http://test/api/experiments/${experimentId}/results${query}`),
    { params: Promise.resolve({ id: experimentId }) },
  )
  return { status: res.status, body: await res.json() }
}

describe('POST /api/events', () => {
  it('records a conversion against the visitor’s variant', async () => {
    const experiment = await createExperiment()
    const { variant } = await assign(experiment.id, 'visitor-1')

    const res = await eventsRoute(
      post('http://test/api/events', {
        experimentId: experiment.id,
        visitorId: 'visitor-1',
      }),
    )

    expect(res.status).toBe(201)
    const { event } = await res.json()
    expect(event.variantId).toBe(variant.id)
    expect(event.name).toBe('conversion')
  })

  it('accepts a custom name and value', async () => {
    const experiment = await createExperiment()
    await assign(experiment.id, 'visitor-1')

    const res = await eventsRoute(
      post('http://test/api/events', {
        experimentId: experiment.id,
        visitorId: 'visitor-1',
        name: 'purchase',
        value: 19.99,
      }),
    )

    expect(res.status).toBe(201)
    const { event } = await res.json()
    expect(event.name).toBe('purchase')
    expect(event.value).toBe(19.99)
  })

  it('returns 400 for a visitor with no assignment', async () => {
    const experiment = await createExperiment()
    const res = await eventsRoute(
      post('http://test/api/events', { experimentId: experiment.id, visitorId: 'stranger' }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no assignment/)
  })

  it('returns 400 when visitorId is missing', async () => {
    const experiment = await createExperiment()
    const res = await eventsRoute(
      post('http://test/api/events', { experimentId: experiment.id }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('visitorId is required')
  })

  it('returns 404 for an unknown experiment', async () => {
    const res = await eventsRoute(
      post('http://test/api/events', { experimentId: 'exp_nope', visitorId: 'visitor-1' }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 for a malformed body', async () => {
    const res = await eventsRoute(post('http://test/api/events', '{ not json'))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/experiments/:id/results', () => {
  it('returns zeroed results before any traffic', async () => {
    const experiment = await createExperiment()
    const { status, body } = await getResults(experiment.id)

    expect(status).toBe(200)
    expect(body.results.totals).toEqual({ visitors: 0, conversions: 0, rate: 0 })
    expect(body.results.eventName).toBe('conversion')
    expect(body.results.leader).toBeNull()
  })

  it('reflects assignments and conversions end to end', async () => {
    const experiment = await createExperiment()
    const seen = new Set<string>()

    for (let i = 0; i < 40; i++) {
      const { variant } = await assign(experiment.id, `visitor-${i}`)
      seen.add(variant.id)
      // Convert the first visitor on each variant, once each.
      if (i < 2) {
        await eventsRoute(
          post('http://test/api/events', {
            experimentId: experiment.id,
            visitorId: `visitor-${i}`,
          }),
        )
      }
    }

    const { body } = await getResults(experiment.id)
    expect(body.results.totals.visitors).toBe(40)
    expect(body.results.totals.conversions).toBeGreaterThan(0)
    expect(body.results.variants).toHaveLength(2)
    expect(seen.size).toBe(2)

    for (const variant of body.results.variants) {
      expect(variant.rate).toBeGreaterThanOrEqual(0)
      expect(variant.rate).toBeLessThanOrEqual(1)
    }
  })

  it('honours the ?event= filter', async () => {
    const experiment = await createExperiment()
    await assign(experiment.id, 'visitor-1')
    await eventsRoute(
      post('http://test/api/events', {
        experimentId: experiment.id,
        visitorId: 'visitor-1',
        name: 'signup',
      }),
    )

    const conversions = await getResults(experiment.id)
    expect(conversions.body.results.totals.conversions).toBe(0)

    const signups = await getResults(experiment.id, '?event=signup')
    expect(signups.body.results.eventName).toBe('signup')
    expect(signups.body.results.totals.conversions).toBe(1)
  })

  it('returns 404 for an unknown experiment', async () => {
    const { status } = await getResults('exp_nope')
    expect(status).toBe(404)
  })
})
