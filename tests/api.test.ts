import { describe, expect, it } from 'vitest'
import { GET as listExperimentsRoute, POST as createExperimentRoute } from '@/app/api/experiments/route'
import { GET as getExperimentRoute } from '@/app/api/experiments/[id]/route'
import { POST as assignRoute } from '@/app/api/assign/route'

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const VALID_BODY = {
  name: 'Hero copy',
  baselineHtml: '<h1>Ship faster</h1>',
  status: 'running',
  variants: [
    { key: 'control', html: '<h1>Ship faster</h1>', isControl: true },
    { key: 'b', html: '<h1>Ship on Friday</h1>' },
  ],
}

async function createExperiment(overrides: Record<string, unknown> = {}) {
  const res = await createExperimentRoute(
    post('http://test/api/experiments', { ...VALID_BODY, ...overrides }),
  )
  expect(res.status).toBe(201)
  const body = await res.json()
  return body.experiment as { id: string; variants: Array<{ id: string; key: string }> }
}

describe('POST /api/experiments', () => {
  it('creates an experiment and returns 201', async () => {
    const experiment = await createExperiment()
    expect(experiment.id).toMatch(/^exp_/)
    expect(experiment.variants).toHaveLength(2)
  })

  it('returns 400 with a message for invalid input', async () => {
    const res = await createExperimentRoute(
      post('http://test/api/experiments', { ...VALID_BODY, name: '' }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('name is required')
  })

  it('returns 400 for a malformed JSON body', async () => {
    const res = await createExperimentRoute(post('http://test/api/experiments', '{ not json'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/valid JSON/)
  })

  it('returns 400 when the body is a JSON array', async () => {
    const res = await createExperimentRoute(post('http://test/api/experiments', []))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/JSON object/)
  })
})

describe('GET /api/experiments', () => {
  it('lists experiments without their HTML payloads', async () => {
    await createExperiment({ name: 'Listed experiment' })

    const res = await listExperimentsRoute()
    expect(res.status).toBe(200)

    const { experiments } = await res.json()
    expect(experiments.length).toBeGreaterThan(0)
    expect(experiments[0]).not.toHaveProperty('baselineHtml')
    expect(experiments.some((e: { name: string }) => e.name === 'Listed experiment')).toBe(true)
  })
})

describe('GET /api/experiments/:id', () => {
  it('returns the experiment with a zeroed split before any traffic', async () => {
    const created = await createExperiment()

    const res = await getExperimentRoute(new Request('http://test'), {
      params: Promise.resolve({ id: created.id }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.experiment.id).toBe(created.id)
    expect(body.assignments).toHaveLength(2)
    expect(body.assignments.every((a: { count: number }) => a.count === 0)).toBe(true)
  })

  it('returns 404 for an unknown id', async () => {
    const res = await getExperimentRoute(new Request('http://test'), {
      params: Promise.resolve({ id: 'exp_missing' }),
    })
    expect(res.status).toBe(404)
  })

  it('reflects assignments once traffic arrives', async () => {
    const created = await createExperiment()
    for (let i = 0; i < 20; i++) {
      await assignRoute(
        post('http://test/api/assign', { experimentId: created.id, visitorId: `v-${i}` }),
      )
    }

    const res = await getExperimentRoute(new Request('http://test'), {
      params: Promise.resolve({ id: created.id }),
    })
    const body = await res.json()
    const total = body.assignments.reduce((sum: number, a: { count: number }) => sum + a.count, 0)
    expect(total).toBe(20)
  })
})

describe('POST /api/assign', () => {
  it('assigns a variant and flags the first sighting', async () => {
    const created = await createExperiment()

    const res = await assignRoute(
      post('http://test/api/assign', { experimentId: created.id, visitorId: 'visitor-1' }),
    )
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(created.variants.map((v) => v.id)).toContain(body.variant.id)
    expect(body.variant.html).toBeTruthy()
    expect(body.visitorId).toBe('visitor-1')
    expect(body.firstSeen).toBe(true)
  })

  it('is sticky across repeat calls', async () => {
    const created = await createExperiment()
    const first = await (
      await assignRoute(
        post('http://test/api/assign', { experimentId: created.id, visitorId: 'visitor-sticky' }),
      )
    ).json()

    for (let i = 0; i < 5; i++) {
      const again = await (
        await assignRoute(
          post('http://test/api/assign', { experimentId: created.id, visitorId: 'visitor-sticky' }),
        )
      ).json()
      expect(again.variant.id).toBe(first.variant.id)
      expect(again.firstSeen).toBe(false)
    }
  })

  it('mints a visitor id when the client has none', async () => {
    const created = await createExperiment()

    const body = await (
      await assignRoute(post('http://test/api/assign', { experimentId: created.id }))
    ).json()

    expect(body.visitorId).toMatch(/^vis_[0-9a-f]{16}$/)

    // The minted id must work on the way back in.
    const returning = await (
      await assignRoute(
        post('http://test/api/assign', {
          experimentId: created.id,
          visitorId: body.visitorId,
        }),
      )
    ).json()
    expect(returning.variant.id).toBe(body.variant.id)
    expect(returning.firstSeen).toBe(false)
  })

  it('returns 400 without an experimentId', async () => {
    const res = await assignRoute(post('http://test/api/assign', { visitorId: 'visitor-1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('experimentId is required')
  })

  it('returns 404 for an unknown experiment', async () => {
    const res = await assignRoute(
      post('http://test/api/assign', { experimentId: 'exp_missing', visitorId: 'visitor-1' }),
    )
    expect(res.status).toBe(404)
  })

  it('keeps experiments independent for the same visitor id', async () => {
    const one = await createExperiment({ name: 'One' })
    const two = await createExperiment({ name: 'Two' })

    const inOne = await (
      await assignRoute(post('http://test/api/assign', { experimentId: one.id, visitorId: 'shared' }))
    ).json()
    const inTwo = await (
      await assignRoute(post('http://test/api/assign', { experimentId: two.id, visitorId: 'shared' }))
    ).json()

    expect(inOne.firstSeen).toBe(true)
    expect(inTwo.firstSeen).toBe(true)
    expect(two.variants.map((v) => v.id)).toContain(inTwo.variant.id)
  })
})
