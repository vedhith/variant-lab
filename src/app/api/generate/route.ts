import { errorResponse, json, readJsonBody } from '@/lib/api'
import { generateVariants, resolveProvider, validateGenerationRequest } from '@/lib/generation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/generate — draft variants of a page.
 *
 * Nothing is persisted. Drafts come back for a human to read, edit, and then
 * send to `POST /api/experiments` if they are worth running. Generation that
 * wrote straight into the experiment would make the first bad variant a
 * database problem instead of a page refresh.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await readJsonBody(req)
    const request = validateGenerationRequest(body)
    const provider = resolveProvider()
    const result = await generateVariants(request, provider)
    return json(result)
  } catch (err) {
    return errorResponse(err)
  }
}

/** GET /api/generate — which provider is configured, so the UI can say so. */
export async function GET(): Promise<Response> {
  try {
    const provider = resolveProvider()
    return json({ provider: provider.name, needsApiKey: provider.needsApiKey })
  } catch (err) {
    return errorResponse(err)
  }
}
