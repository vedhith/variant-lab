import { getDatabase } from '@/lib/db'
import { experimentResults } from '@/lib/results'
import { errorResponse, json } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/experiments/:id/results?event=conversion
 *
 * Per-variant conversion rates with confidence intervals, each variant's lift
 * over the control, and whether that lift has separated from noise yet.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params
    const eventName = new URL(req.url).searchParams.get('event') ?? undefined
    return json({ results: experimentResults(getDatabase(), id, eventName) })
  } catch (err) {
    return errorResponse(err)
  }
}
