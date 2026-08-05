import { errorResponse, json, readJsonBody } from '@/lib/api'
import { importPage } from '@/lib/importing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/import — fetch a live page and return it as a baseline.
 *
 * Like generation, nothing is persisted: the markup comes back for a person to
 * look at before it becomes the control everything else is measured against.
 * A page that imports badly should cost a page refresh, not a stored
 * experiment with a mangled baseline.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJsonBody(req)
    const page = await importPage(body.url)
    return json(page)
  } catch (err) {
    return errorResponse(err)
  }
}
