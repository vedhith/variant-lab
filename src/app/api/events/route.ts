import { getDatabase } from '@/lib/db'
import { recordEvent } from '@/lib/events'
import { errorResponse, json, readJsonBody } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/events — record a conversion (or any other tracked action).
 *
 * Body: `{ experimentId: string, visitorId: string, name?: string, value?: number }`
 *
 * The variant is not part of the request: it is read from the visitor's
 * assignment, so a client cannot attribute a conversion to a variant it was
 * never shown. A visitor with no assignment is a 400.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJsonBody(req)

    const event = recordEvent(getDatabase(), {
      experimentId: typeof body.experimentId === 'string' ? body.experimentId : '',
      visitorId: typeof body.visitorId === 'string' ? body.visitorId : '',
      name: typeof body.name === 'string' ? body.name : undefined,
      value: body.value as number | null | undefined,
    })

    return json({ event }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
