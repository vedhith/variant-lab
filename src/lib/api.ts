import { NotFoundError, ValidationError } from './experiments'
import { BucketingError } from './bucketing'
import { GenerationError, NoVariantsError } from './generation/types'

export interface ApiErrorBody {
  error: string
}

/**
 * Map a domain error onto an HTTP response.
 *
 * Keeping this in one place means route handlers can let errors propagate
 * instead of each one inventing its own status codes.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof ValidationError || err instanceof BucketingError) {
    return json<ApiErrorBody>({ error: err.message }, 400)
  }
  if (err instanceof NotFoundError) {
    return json<ApiErrorBody>({ error: err.message }, 404)
  }
  // The generator worked and found nothing to change. The request was fine, so
  // it is not a 400, and nothing upstream broke, so it is not a 502.
  if (err instanceof NoVariantsError) {
    return json<ApiErrorBody>({ error: err.message }, 422)
  }
  // The generator failed, not the request. 502 rather than 500 so a caller can
  // tell "retry this" apart from "this will never work".
  if (err instanceof GenerationError) {
    return json<ApiErrorBody>({ error: err.message }, 502)
  }
  // Anything else is a bug, not a client mistake. Log it for the server
  // operator and tell the caller nothing about the internals.
  console.error('[variant-lab] unhandled error', err)
  return json<ApiErrorBody>({ error: 'internal server error' }, 500)
}

export function json<T>(body: T, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** Parse a JSON request body, rejecting anything that is not a JSON object. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw new ValidationError('request body must be valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}
