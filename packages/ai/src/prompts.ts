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
// Backstop against a server whose pagination never terminates. 100 pages of the
// default page size covers 10,000 prompts; past that getAll throws rather than
// returning a truncated result.
const MAX_PROMPT_LIST_PAGES = 100
// After a failed refetch the stale entry is served for this long before the next network attempt.
// The server's tightest prompt limit is per-minute, so a minute lets the bucket refill.
const DEFAULT_REFETCH_COOLDOWN_SECONDS = 60
const MAX_REFETCH_COOLDOWN_SECONDS = 3600
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

/** Reads config from an API response, tolerating servers that don't send it. */
function extractConfig(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

/** Copied so a caller mutating result.config can't pollute the cache entry later reads are served from. */
function cloneConfig(config: Record<string, unknown> | null): Record<string, unknown> | null {
  return config === null ? null : structuredClone(config)
}

/** Reads a Retry-After header of the delta-seconds form the API sends. */
function parseRetryAfterSeconds(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const seconds = Number(value.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined
  }
  return Math.min(seconds, MAX_REFETCH_COOLDOWN_SECONDS)
}

/** Carries the server's own cooldown so a rate-limited client waits as long as it was told to. */
class PromptFetchError extends Error {
  readonly retryAfterSeconds?: number

  constructor(message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'PromptFetchError'
    this.retryAfterSeconds = retryAfterSeconds
  }
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

function isSameOrigin(url: string, host: string): boolean {
  try {
    return new URL(url).origin === new URL(host).origin
  } catch {
    return false
  }
}

/**
 * Classify how a list row relates to the requested label, via its all_labels
 * field.
 *
 * 'resolved': the row is the version the label points to.
 * 'moved': the prompt carries the label, but on another version. Happens when
 * the label moves between the query and the response.
 * 'absent': the prompt does not carry the label at any version. A server that
 * filters by label never returns such a row, so this means the server ignored
 * the label param (an older PostHog release) and served latest versions.
 */
function rowLabelState(row: PromptApiResponse, label: string): 'resolved' | 'moved' | 'absent' {
  const allLabels = (row as unknown as Record<string, unknown>).all_labels
  if (!Array.isArray(allLabels)) {
    return 'absent'
  }
  const entry = allLabels.find(
    (candidate) =>
      typeof candidate === 'object' && candidate !== null && (candidate as Record<string, unknown>).name === label
  )
  if (entry === undefined) {
    return 'absent'
  }
  return (entry as Record<string, unknown>).version === row.version ? 'resolved' : 'moved'
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
 * // Or fetch all prompts at a label in one request and warm the cache
 * const prodPrompts = await prompts.getAll({ label: 'production' })
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
   * `name`, `version`, and `config` metadata. Read `result.prompt` for the
   * template string and `result.config ?? {}` for model parameters or agent
   * configuration stored with the version.
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
          config: undefined,
        } satisfies PromptCodeFallbackResult
      }

      throw error
    }
  }

  /**
   * Fetch every prompt that carries a label, in one batch.
   *
   * Returns an object mapping prompt name to `PromptRemoteResult`, with each
   * prompt at the version the label points to. Prompts without the label are
   * not included.
   *
   * Each fetched prompt is stored in the cache, so later
   * `get(name, { label })` calls are served from cache within the TTL. An app
   * with many prompts can call this once per cache cycle instead of making one
   * `get()` request per prompt.
   *
   * Throws if the request fails, or if the server does not support fetching
   * prompts by label on the list endpoint (PostHog releases from before
   * September 2026).
   */
  async getAll(options: { label: string }): Promise<Record<string, PromptRemoteResult>> {
    const label = options.label
    const rows = await this.fetchPromptListFromApi(label)

    // Validate every row before caching any, so a rejected batch leaves the
    // cache untouched.
    const resolvedRows: PromptApiResponse[] = []
    const skipped: string[] = []
    for (const row of rows) {
      if (!isPromptApiResponse(row)) {
        throw new Error(`[PostHog Prompts] Invalid response format for prompts with label "${label}"`)
      }
      const labelState = rowLabelState(row, label)
      if (labelState === 'absent') {
        // Even one unlabeled row proves the server did not filter, and then
        // rows that look resolved are only labels that happen to point at the
        // latest version. A partial result here would hide the rest, so fail
        // loudly instead.
        throw new Error(
          `[PostHog Prompts] The server returned a prompt that does not carry label "${label}". ` +
            'It may not support fetching prompts by label on the list endpoint yet. ' +
            'Upgrade PostHog, or fetch prompts one by one with get().'
        )
      }
      if (labelState === 'moved') {
        skipped.push(row.name)
        continue
      }
      resolvedRows.push(row)
    }

    const now = Date.now()
    // Collected in a Map first: prompt names like __proto__ are valid, and
    // assigning them into a plain object would change its prototype instead of
    // adding an entry. Object.fromEntries defines own properties, so the
    // returned object carries every name safely.
    const results = new Map<string, PromptRemoteResult>()
    for (const row of resolvedRows) {
      const config = extractConfig((row as unknown as Record<string, unknown>).config)
      this.getOrCreatePromptCache(row.name).set(label, {
        prompt: row.prompt,
        name: row.name,
        version: row.version,
        label,
        config,
        fetchedAt: now,
      })
      results.set(row.name, {
        source: 'api',
        prompt: row.prompt,
        name: row.name,
        version: row.version,
        label,
        config: cloneConfig(config),
      })
    }

    if (skipped.length > 0) {
      console.warn(
        `[PostHog Prompts] Skipped ${skipped.length} prompt(s) that did not resolve label "${label}": ${skipped.join(', ')}`
      )
    }

    return Object.fromEntries(results)
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
        return { source: 'cache', ...this.readCacheEntry(cached) }
      }

      // A failed refetch left this entry in cooldown. Serving it keeps one throttled client from
      // turning every later get() into another request, which is what holds it against the limit.
      if (cached.retryNotBefore !== undefined && now < cached.retryNotBefore) {
        return { source: 'stale_cache', ...this.readCacheEntry(cached) }
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

      return { source: 'api', ...fetched, config: cloneConfig(fetched.config) }
    } catch (error) {
      // Return stale cache (with warning)
      if (cached) {
        const cooldownSeconds =
          (error instanceof PromptFetchError ? error.retryAfterSeconds : undefined) ?? DEFAULT_REFETCH_COOLDOWN_SECONDS
        cached.retryNotBefore = Math.max(cached.retryNotBefore ?? 0, Date.now() + cooldownSeconds * 1000)
        console.warn(`[PostHog Prompts] Failed to fetch prompt ${promptReference}, using stale cache:`, error)
        return { source: 'stale_cache', ...this.readCacheEntry(cached) }
      }

      throw error
    }
  }

  private readCacheEntry(cached: CachedPrompt): Omit<PromptRemoteResult, 'source'> {
    const { fetchedAt: _fetchedAt, retryNotBefore: _retryNotBefore, ...cachedResult } = cached
    return { ...cachedResult, config: cloneConfig(cached.config) }
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

  private requireCredentials(): void {
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
  }

  /**
   * Fetch all prompts at a label from the paginated list endpoint.
   * Follows pagination links until the last page and returns the raw rows.
   */
  private async fetchPromptListFromApi(label: string): Promise<unknown[]> {
    this.requireCredentials()

    const query = `token=${encodeURIComponent(this.projectApiKey)}&label=${encodeURIComponent(label)}&content=full`
    let url: string | undefined = `${this.host}/api/environments/@current/llm_prompts/?${query}`
    const reference = `prompts with label "${label}"`

    const rows: unknown[] = []
    let pages = 0
    while (url !== undefined) {
      if (pages >= MAX_PROMPT_LIST_PAGES) {
        // A truncated result must not look complete: callers would cache a
        // partial prompt set and treat missing prompts as unlabeled.
        throw new Error(
          `[PostHog Prompts] ${reference} spans more than ${MAX_PROMPT_LIST_PAGES} pages. ` +
            'Refusing to return an incomplete result.'
        )
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.personalApiKey}`,
        },
      })

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error(
            `[PostHog Prompts] Access denied for ${reference}. ` +
              'Check that your personalApiKey has the correct permissions and the LLM prompts feature is enabled.'
          )
        }
        throw new PromptFetchError(
          `[PostHog Prompts] Failed to fetch ${reference}: HTTP ${response.status}`,
          response.status === 429 ? parseRetryAfterSeconds(response.headers?.get('Retry-After')) : undefined
        )
      }

      const data: unknown = await response.json()
      if (typeof data !== 'object' || data === null || !Array.isArray((data as Record<string, unknown>).results)) {
        throw new Error(`[PostHog Prompts] Invalid response format for ${reference}`)
      }
      rows.push(...((data as Record<string, unknown>).results as unknown[]))

      // The Authorization header goes to every followed link, so a link off
      // the configured host must never be requested.
      const nextUrl = (data as Record<string, unknown>).next
      if (
        nextUrl !== null &&
        nextUrl !== undefined &&
        (typeof nextUrl !== 'string' || !isSameOrigin(nextUrl, this.host))
      ) {
        throw new Error(
          `[PostHog Prompts] Refusing to follow a pagination link off the configured host while fetching ${reference}.`
        )
      }
      url = nextUrl === null || nextUrl === undefined ? undefined : (nextUrl as string)
      pages += 1
    }

    return rows
  }

  private async fetchPromptFromApi(
    name: string,
    version?: number,
    label?: string
  ): Promise<Omit<PromptRemoteResult, 'source'>> {
    this.requireCredentials()

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

      throw new PromptFetchError(
        `[PostHog Prompts] Failed to fetch prompt ${promptReference}: HTTP ${response.status}`,
        response.status === 429 ? parseRetryAfterSeconds(response.headers?.get('Retry-After')) : undefined
      )
    }

    const data: unknown = await response.json()

    if (!isPromptApiResponse(data)) {
      throw new Error(`[PostHog Prompts] Invalid response format for prompt ${promptReference}`)
    }

    return {
      prompt: data.prompt,
      name: data.name,
      version: data.version,
      label: data.label,
      config: extractConfig(data.config),
    }
  }
}
