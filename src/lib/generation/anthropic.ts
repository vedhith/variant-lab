/**
 * Anthropic Messages API provider.
 *
 * Deliberately a `fetch` call rather than an SDK dependency: the request is
 * fifteen lines, and Variant Lab shipping with zero runtime dependencies for
 * generation makes it much easier for someone to swap in their own provider.
 * Adding one means implementing `VariantProvider` — nothing else in the app
 * knows which model produced a variant.
 */

import { buildUserPrompt, parseGeneratedVariants, SYSTEM_PROMPT } from './prompt'
import { variantKey } from './keys'
import { GenerationError, type GeneratedVariant, type GenerationRequest, type VariantProvider } from './types'

export const DEFAULT_MODEL = 'claude-sonnet-5'
export const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 8000
const DEFAULT_TIMEOUT_MS = 60_000

export interface AnthropicProviderOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  maxTokens?: number
  timeoutMs?: number
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

interface AnthropicContentBlock {
  type: string
  text?: string
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  error?: { message?: string }
}

/** Concatenate the text blocks of a Messages response, ignoring any other block type. */
function textFrom(body: AnthropicResponse): string {
  return (body.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
}

export function createAnthropicProvider(options: AnthropicProviderOptions): VariantProvider {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = options

  if (!apiKey) throw new GenerationError('an Anthropic API key is required')

  return {
    name: 'anthropic',
    needsApiKey: true,
    async generate(request: GenerationRequest): Promise<GeneratedVariant[]> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      let response: Response
      try {
        response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildUserPrompt(request) }],
          }),
          signal: controller.signal,
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new GenerationError(`the model did not respond within ${timeoutMs} ms`)
        }
        throw new GenerationError(`could not reach the model: ${(err as Error).message}`)
      } finally {
        clearTimeout(timer)
      }

      const raw = await response.text()
      let body: AnthropicResponse
      try {
        body = JSON.parse(raw) as AnthropicResponse
      } catch {
        throw new GenerationError(`the model API returned a non-JSON response (${response.status})`)
      }

      if (!response.ok) {
        // The upstream message names the real problem (bad key, rate limit,
        // unknown model); passing it through saves an hour of guessing.
        throw new GenerationError(
          `the model API returned ${response.status}: ${body.error?.message ?? 'no message'}`,
        )
      }

      return parseGeneratedVariants(textFrom(body)).map((variant, index) => ({
        key: variantKey(index),
        html: variant.html,
        rationale: variant.rationale,
      }))
    },
  }
}
