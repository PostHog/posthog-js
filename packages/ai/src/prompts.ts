/// <reference lib="dom" />

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
 *   projectApiKey: 'phc_xxx',
 *   host: 'https://us.posthog.com',
 * })
 *
 * // Fetch with caching and fallback
 * const template = await prompts.get('support-system-prompt', {
 *   cacheTtlSeconds: 300,
 *   fallback: 'You are a helpful assistant.',
 * })
 *
 * // Or fetch an exact published version
 * const v3Template = await prompts.get('support-system-prompt', {
 *   version: 3,
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
  private projectApiKey: string
  private host: string
  private defaultCacheTtlSeconds: number
  private cache: Map<string, CachedPrompt> = new Map()

  constructor(options: PromptsOptions) {
    this.defaultCacheTtlSeconds = options.defaultCacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS

    if (isPromptsWithPostHog(options)) {
      this.personalApiKey = options.posthog.options.personalApiKey ?? ''
      this.projectApiKey = options.posthog.apiKey ?? ''
      this.host = options.posthog.host
    } else {
      // Direct options
      this.personalApiKey = options.personalApiKey
      this.projectApiKey = options.projectApiKey
      this.host = options.host ?? 'https://us.posthog.com'
    }
  }

  private getCacheKey(name: string, version?: number): string {
    return version === undefined ? `${name}::latest` : `${name}::version:${version}`
  }

  private getPromptLabel(name: string, version?: number): string {
    return version === undefined ? `"${name}"` : `"${name}" version ${version}`
  }

  /**
   * Fetch a prompt by name from the PostHog API
   *
   * @param name - The name of the prompt to fetch
   * @param options - Optional settings for caching, fallback, and exact version selection
   * @returns The prompt string
   * @throws Error if the prompt cannot be fetched and no fallback is provided
   */
  async get(name: string, options?: GetPromptOptions): Promise<string> {
    const cacheTtlSeconds = options?.cacheTtlSeconds ?? this.defaultCacheTtlSeconds
    const fallback = options?.fallback
    const version = options?.version
    const cacheKey = this.getCacheKey(name, version)
    const promptLabel = this.getPromptLabel(name, version)

    // Check cache first
    const cached = this.cache.get(cacheKey)
    const now = Date.now()

    if (cached) {
      const isFresh = now - cached.fetchedAt < cacheTtlSeconds * 1000

      if (isFresh) {
        return cached.prompt
      }
    }

    // Try to fetch from API
    try {
      const prompt = await this.fetchPromptFromApi(name, version)
      const fetchedAt = Date.now()

      // Update cache
      this.cache.set(cacheKey, {
        prompt,
        fetchedAt,
      })

      return prompt
    } catch (error) {
      // Fallback order:
      // 1. Return stale cache (with warning)
      if (cached) {
        console.warn(`[PostHog Prompts] Failed to fetch prompt ${promptLabel}, using stale cache:`, error)
        return cached.prompt
      }

      // 2. Return fallback (with warning)
      if (fallback !== undefined) {
        console.warn(`[PostHog Prompts] Failed to fetch prompt ${promptLabel}, using fallback:`, error)
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
   * @param name - Optional prompt name to clear. If provided, clears all cached versions for that prompt.
   */
  clearCache(name?: string): void {
    if (name !== undefined) {
      const latestKey = this.getCacheKey(name)
      const versionPrefix = `${name}::version:`
      for (const key of this.cache.keys()) {
        if (key === latestKey) {
          this.cache.delete(key)
          continue
        }

        if (key.startsWith(versionPrefix) && /^\d+$/.test(key.slice(versionPrefix.length))) {
          this.cache.delete(key)
        }
      }
    } else {
      this.cache.clear()
    }
  }

  private async fetchPromptFromApi(name: string, version?: number): Promise<string> {
    if (!this.personalApiKey) {
      throw new Error(
        '[PostHog Prompts] personalApiKey is required to fetch prompts. ' +
          'Please provide it when initializing the Prompts instance.'
      )
    }
    if (!this.projectApiKey) {
      throw new Error(
        '[PostHog Prompts] projectApiKey is required to fetch prompts. ' +
          'Please provide it when initializing the Prompts instance.'
      )
    }

    const encodedPromptName = encodeURIComponent(name)
    const encodedProjectApiKey = encodeURIComponent(this.projectApiKey)
    const versionQuery = version === undefined ? '' : `&version=${encodeURIComponent(String(version))}`
    const promptLabel = this.getPromptLabel(name, version)
    const url = `${this.host}/api/environments/@current/llm_prompts/name/${encodedPromptName}/?token=${encodedProjectApiKey}${versionQuery}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.personalApiKey}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`[PostHog Prompts] Prompt ${promptLabel} not found`)
      }

      if (response.status === 403) {
        throw new Error(
          `[PostHog Prompts] Access denied for prompt ${promptLabel}. ` +
            'Check that your personalApiKey has the correct permissions and the LLM prompts feature is enabled.'
        )
      }

      throw new Error(`[PostHog Prompts] Failed to fetch prompt ${promptLabel}: HTTP ${response.status}`)
    }

    const data: unknown = await response.json()

    if (!isPromptApiResponse(data)) {
      throw new Error(`[PostHog Prompts] Invalid response format for prompt ${promptLabel}`)
    }

    return data.prompt
  }
}
