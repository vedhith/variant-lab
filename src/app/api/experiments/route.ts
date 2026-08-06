import { getDatabase } from '@/lib/db'
import { createExperiment, listExperiments } from '@/lib/experiments'
import { errorResponse, json, readJsonBody } from '@/lib/api'
import { assertRoomForExperiment } from '@/lib/hosting'
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
    const db = getDatabase()
    // Checked before the body is read: on a full demo instance the answer is
    // the same whatever the payload says, and there is no reason to parse
    // half a megabyte of HTML to arrive at it.
    assertRoomForExperiment(db)
    const body = await readJsonBody(req)
    const experiment = createExperiment(db, body as unknown as NewExperimentInput)
    return json({ experiment }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
