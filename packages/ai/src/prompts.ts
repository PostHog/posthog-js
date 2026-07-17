/// <reference lib="dom" />

import type { PostHog } from 'posthog-node'
import type {
  CachedPrompt,
  GetPromptOptions,
  PromptApiResponse,
  PromptCodeFallbackResult,
  PromptRemoteResult,
  PromptResult,
  PromptVariables,
  PromptsDirectOptions,
} from './types'

const DEFAULT_CACHE_TTL_SECONDS = 300 // 5 minutes
const DEFAULT_PROMPTS_HOST = 'https://us.posthog.com'
// Keyed by version number, label string, or undefined for the latest version.
// Version and label keys can't collide: one is always a number, the other a string.
type PromptVersionCache = Map<number | string | undefined, CachedPrompt>

function normalizeApiKey(value?: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeHost(value?: unknown): string {
  const normalizedHost = typeof value === 'string' ? value.trim() : ''
  return (normalizedHost || DEFAULT_PROMPTS_HOST).replace(/\/+$/, '')
}

function isPromptApiResponse(data: unknown): data is PromptApiResponse {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const record = data as Record<string, unknown>
  return (
    typeof record.prompt === 'string' &&
    typeof record.name === 'string' &&
    typeof record.version === 'number' &&
    (record.label === undefined || typeof record.label === 'string')
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
 * const result = await prompts.get('support-system-prompt', {
 *   cacheTtlSeconds: 300,
 *   fallback: 'You are a helpful assistant.',
 * })
 *
 * // Or fetch an exact published version
 * const v3 = await prompts.get('support-system-prompt', {
 *   version: 3,
 * })
 *
 * // Or fetch the version a label currently points to
 * const prod = await prompts.get('support-system-prompt', {
 *   label: 'production',
 * })
 *
 * // Compile with variables
 * const systemPrompt = prompts.compile(result.prompt, {
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
  private cache: Map<string, PromptVersionCache> = new Map()

  constructor(options: PromptsOptions) {
    this.defaultCacheTtlSeconds = options.defaultCacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS

    if (isPromptsWithPostHog(options)) {
      this.personalApiKey = options.posthog.options.personalApiKey ?? ''
      this.projectApiKey = options.posthog.apiKey
      this.host = options.posthog.host
    } else {
      // Direct options
      this.personalApiKey = normalizeApiKey(options.personalApiKey)
      this.projectApiKey = normalizeApiKey(options.projectApiKey)
      this.host = normalizeHost(options.host)
    }
  }

  private getPromptCache(name: string): PromptVersionCache | undefined {
    return this.cache.get(name)
  }

  private getOrCreatePromptCache(name: string): PromptVersionCache {
    const cachedPromptVersions = this.cache.get(name)
    if (cachedPromptVersions) {
      return cachedPromptVersions
    }

    const promptVersions: PromptVersionCache = new Map()
    this.cache.set(name, promptVersions)
    return promptVersions
  }

  private getPromptReference(name: string, version?: number, label?: string): string {
    if (version !== undefined) {
      return `"${name}" version ${version}`
    }
    if (label !== undefined) {
      return `"${name}" label "${label}"`
    }
    return `"${name}"`
  }

  /**
   * Fetch a prompt by name from the PostHog API.
   *
   * Returns a `PromptResult` object carrying the prompt text alongside `source`,
   * `name`, and `version` metadata. Read `result.prompt` for the template string.
   */
  async get(name: string, options?: GetPromptOptions): Promise<PromptResult> {
    if (options?.version !== undefined && options?.label !== undefined) {
      throw new Error('[PostHog Prompts] Pass either version or label, not both.')
    }

    try {
      return await this.getInternal(name, options)
    } catch (error) {
      const fallback = options?.fallback

      if (fallback !== undefined) {
        const promptReference = this.getPromptReference(name, options?.version, options?.label)
        console.warn(`[PostHog Prompts] Failed to fetch prompt ${promptReference}, using fallback:`, error)

        return {
          source: 'code_fallback',
          prompt: fallback,
          name: undefined,
          version: undefined,
          label: undefined,
        } satisfies PromptCodeFallbackResult
      }

      throw error
    }
  }

  /**
   * Internal method that handles cache + fetch logic, returning full metadata.
   * Does NOT handle the string `fallback` option — callers handle that.
   */
  private async getInternal(name: string, options?: GetPromptOptions): Promise<PromptRemoteResult> {
    const cacheTtlSeconds = options?.cacheTtlSeconds ?? this.defaultCacheTtlSeconds
    const version = options?.version
    const label = options?.label
    const promptReference = this.getPromptReference(name, version, label)
    const cacheEntryKey = version ?? label

    // Check cache first
    const cached = this.getPromptCache(name)?.get(cacheEntryKey)
    const now = Date.now()

    if (cached) {
      const isFresh = now - cached.fetchedAt < cacheTtlSeconds * 1000

      if (isFresh) {
        const { fetchedAt: _, ...cachedResult } = cached
        return { source: 'cache', ...cachedResult }
      }
    }

    // Try to fetch from API
    try {
      const fetched = await this.fetchPromptFromApi(name, version, label)

      // An older PostHog server ignores the label param and returns the latest
      // version with no label field — surface that instead of failing silently.
      if (label !== undefined && fetched.label !== label) {
        console.warn(
          `[PostHog Prompts] Requested label "${label}" for prompt "${name}" but the server resolved ` +
            `${fetched.label === undefined ? 'no label' : `"${fetched.label}"`}. It may not support prompt ` +
            'labels yet and returned the latest version instead.'
        )
      }

      // Update cache
      this.getOrCreatePromptCache(name).set(cacheEntryKey, { ...fetched, fetchedAt: Date.now() })

      return { source: 'api', ...fetched }
    } catch (error) {
      // Return stale cache (with warning)
      if (cached) {
        const { fetchedAt: _, ...cachedResult } = cached
        console.warn(`[PostHog Prompts] Failed to fetch prompt ${promptReference}, using stale cache:`, error)
        return { source: 'stale_cache', ...cachedResult }
      }

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
   * @param name - Optional prompt name to clear. If provided, clears all cached versions for that prompt unless a version is also provided.
   * @param version - Optional prompt version to clear. Requires a prompt name.
   */
  clearCache(name?: string, version?: number): void {
    if (version !== undefined && name === undefined) {
      throw new Error("'version' requires 'name' to be provided")
    }

    if (name === undefined) {
      this.cache.clear()
      return
    }

    if (version === undefined) {
      this.cache.delete(name)
      return
    }

    const promptVersions = this.getPromptCache(name)
    promptVersions?.delete(version)

    if (promptVersions?.size === 0) {
      this.cache.delete(name)
    }
  }

  private async fetchPromptFromApi(
    name: string,
    version?: number,
    label?: string
  ): Promise<Omit<PromptRemoteResult, 'source'>> {
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
    const labelQuery = label === undefined ? '' : `&label=${encodeURIComponent(label)}`
    const promptReference = this.getPromptReference(name, version, label)
    const url = `${this.host}/api/environments/@current/llm_prompts/name/${encodedPromptName}/?token=${encodedProjectApiKey}${versionQuery}${labelQuery}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.personalApiKey}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`[PostHog Prompts] Prompt ${promptReference} not found`)
      }

      if (response.status === 403) {
        throw new Error(
          `[PostHog Prompts] Access denied for prompt ${promptReference}. ` +
            'Check that your personalApiKey has the correct permissions and the LLM prompts feature is enabled.'
        )
      }

      throw new Error(`[PostHog Prompts] Failed to fetch prompt ${promptReference}: HTTP ${response.status}`)
    }

    const data: unknown = await response.json()

    if (!isPromptApiResponse(data)) {
      throw new Error(`[PostHog Prompts] Invalid response format for prompt ${promptReference}`)
    }

    return { prompt: data.prompt, name: data.name, version: data.version, label: data.label }
  }
}
