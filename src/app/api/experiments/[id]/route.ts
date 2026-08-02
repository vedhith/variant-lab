import { getDatabase } from '@/lib/db'
import { assignmentCounts, getExperiment } from '@/lib/experiments'
import { errorResponse, json } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/experiments/:id — the experiment, its variants, and its split so far. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params
    const db = getDatabase()
    const experiment = getExperiment(db, id)
    const counts = assignmentCounts(db, id)

    return json({
      experiment,
      assignments: experiment.variants.map((v) => ({
        variantId: v.id,
        key: v.key,
        count: counts.get(v.id) ?? 0,
      })),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
