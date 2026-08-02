import { getDatabase } from '@/lib/db'
import { assignVisitor } from '@/lib/experiments'
import { ValidationError } from '@/lib/experiments'
import { errorResponse, json, readJsonBody } from '@/lib/api'
import { newVisitorId } from '@/lib/ids'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/assign — the endpoint a page calls on load.
 *
 * Body: `{ experimentId: string, visitorId?: string }`
 *
 * A visitor arriving without an id gets one minted here and returned; the
 * client is expected to persist it (localStorage today, the embed SDK later)
 * and send it back on every subsequent call.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJsonBody(req)

    const experimentId = typeof body.experimentId === 'string' ? body.experimentId.trim() : ''
    if (!experimentId) throw new ValidationError('experimentId is required')

    const provided = typeof body.visitorId === 'string' ? body.visitorId.trim() : ''
    const visitorId = provided || newVisitorId()

    const result = assignVisitor(getDatabase(), experimentId, visitorId)

    return json({
      experimentId,
      visitorId,
      variant: {
        id: result.variant.id,
        key: result.variant.key,
        html: result.variant.html,
        isControl: result.variant.isControl,
      },
      assignedAt: result.assignment.assignedAt,
      /** True only on the visitor's first assignment for this experiment. */
      firstSeen: result.created,
    })
  } catch (err) {
    return errorResponse(err)
  }
}
