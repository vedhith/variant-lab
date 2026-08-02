import { getDatabase } from '@/lib/db'
import { createExperiment, listExperiments } from '@/lib/experiments'
import { errorResponse, json, readJsonBody } from '@/lib/api'
import type { NewExperimentInput } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/experiments — most recent experiments, without their HTML bodies. */
export async function GET(): Promise<Response> {
  try {
    const experiments = listExperiments(getDatabase()).map(
      ({ baselineHtml: _baselineHtml, ...rest }) => rest,
    )
    return json({ experiments })
  } catch (err) {
    return errorResponse(err)
  }
}

/** POST /api/experiments — create an experiment and its variants. */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJsonBody(req)
    const experiment = createExperiment(
      getDatabase(),
      body as unknown as NewExperimentInput,
    )
    return json({ experiment }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
