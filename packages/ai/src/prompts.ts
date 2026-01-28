import type { PostHog } from 'posthog-node'
import type { CachedPrompt, GetPromptOptions, PromptApiResponse, PromptVariables, PromptsDirectOptions } from './types'

const DEFAULT_CACHE_TTL_SECONDS = 300 // 5 minutes

function isPromptApiResponse(data: unknown): data is PromptApiResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'prompt' in data &&
    typeof (data as PromptApiResponse).prompt === 'string'
  )
}

export interface PromptsWithPostHogOptions {
  posthog: PostHog
  defaultCacheTtlSeconds?: number
}

export type PromptsOptions = PromptsWithPostHogOptions | PromptsDirectOptions

function isPromptsWithPostHog(options: PromptsOptions): options is PromptsWithPostHogOptions {
  return 'posthog' in options
}

/**
 * Prompts class for fetching and compiling LLM prompts from PostHog
 *
 * @example
 * ```ts
 * // With PostHog client
 * const prompts = new Prompts({ posthog })
 *
 * // Or with direct options (no PostHog client needed)
 * const prompts = new Prompts({
 *   personalApiKey: 'phx_xxx',
 *   host: 'https://us.i.posthog.com',
 * })
 *
 * // Fetch with caching and fallback
 * const template = await prompts.get('support-system-prompt', {
 *   cacheTtlSeconds: 300,
 *   fallback: 'You are a helpful assistant.',
 * })
 *
 * // Compile with variables
 * const systemPrompt = prompts.compile(template, {
 *   company: 'Acme Corp',
 *   tier: 'premium',
 * })
 * ```
 */
export class Prompts {
  private personalApiKey: string
  private host: string
  private defaultCacheTtlSeconds: number
  private cache: Map<string, CachedPrompt> = new Map()

  constructor(options: PromptsOptions) {
    this.defaultCacheTtlSeconds = options.defaultCacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS

    if (isPromptsWithPostHog(options)) {
      this.personalApiKey = options.posthog.options.personalApiKey ?? ''
      this.host = options.posthog.host
    } else {
      // Direct options
      this.personalApiKey = options.personalApiKey
      this.host = options.host ?? 'https://us.i.posthog.com'
    }
  }

  /**
   * Fetch a prompt by name from the PostHog API
   *
   * @param name - The name of the prompt to fetch
   * @param options - Optional settings for caching and fallback
   * @returns The prompt string
   * @throws Error if the prompt cannot be fetched and no fallback is provided
   */
  async get(name: string, options?: GetPromptOptions): Promise<string> {
    const cacheTtlSeconds = options?.cacheTtlSeconds ?? this.defaultCacheTtlSeconds
    const fallback = options?.fallback

    // Check cache first
    const cached = this.cache.get(name)
    const now = Date.now()

    if (cached) {
      const isFresh = now - cached.fetchedAt < cacheTtlSeconds * 1000

      if (isFresh) {
        return cached.prompt
      }
    }

    // Try to fetch from API
    try {
      const prompt = await this.fetchPromptFromApi(name)

      // Update cache
      this.cache.set(name, {
        prompt,
        fetchedAt: now,
      })

      return prompt
    } catch (error) {
      // Fallback order:
      // 1. Return stale cache (with warning)
      if (cached) {
        console.warn(`[PostHog Prompts] Failed to fetch prompt "${name}", using stale cache:`, error)
        return cached.prompt
      }

      // 2. Return fallback (with warning)
      if (fallback !== undefined) {
        console.warn(`[PostHog Prompts] Failed to fetch prompt "${name}", using fallback:`, error)
        return fallback
      }

      // 3. Throw error
      throw error
    }
  }

  /**
   * Compile a prompt template with variable substitution
   *
   * Variables in the format `{{variableName}}` will be replaced with values from the variables object.
   * Unmatched variables are left unchanged.
   *
   * @param prompt - The prompt template string
   * @param variables - Object containing variable values
   * @returns The compiled prompt string
   */
  compile(prompt: string, variables: PromptVariables): string {
    return prompt.replace(/\{\{([\w.-]+)\}\}/g, (match, variableName) => {
      if (variableName in variables) {
        return String(variables[variableName])
      }

      return match
    })
  }

  /**
   * Clear the cache for a specific prompt or all prompts
   *
   * @param name - Optional prompt name to clear. If not provided, clears all cached prompts.
   */
  clearCache(name?: string): void {
    if (name !== undefined) {
      this.cache.delete(name)
    } else {
      this.cache.clear()
    }
  }

  private async fetchPromptFromApi(name: string): Promise<string> {
    if (!this.personalApiKey) {
      throw new Error(
        '[PostHog Prompts] personalApiKey is required to fetch prompts. ' +
          'Please provide it when initializing the Prompts instance.'
      )
    }

    const url = `${this.host}/api/projects/@current/llm_prompts/name/${encodeURIComponent(name)}/`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.personalApiKey}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`[PostHog Prompts] Prompt "${name}" not found`)
      }

      if (response.status === 403) {
        throw new Error(
          `[PostHog Prompts] Access denied for prompt "${name}". ` +
            'Check that your personalApiKey has the correct permissions and the LLM prompts feature is enabled.'
        )
      }

      throw new Error(`[PostHog Prompts] Failed to fetch prompt "${name}": HTTP ${response.status}`)
    }

    const data: unknown = await response.json()

    if (!isPromptApiResponse(data)) {
      throw new Error(`[PostHog Prompts] Invalid response format for prompt "${name}"`)
    }

    return data.prompt
  }
}
