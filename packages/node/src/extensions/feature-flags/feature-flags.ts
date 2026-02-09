import { FeatureFlagCondition, FlagProperty, FlagPropertyValue, PostHogFeatureFlag, PropertyGroup } from '../../types'
import type { FeatureFlagValue, JsonType, PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'
import { safeSetTimeout } from '@posthog/core'
import { hashSHA1 } from './crypto'
import { FlagDefinitionCacheProvider, FlagDefinitionCacheData } from './cache'

const SIXTY_SECONDS = 60 * 1000

// eslint-disable-next-line
const LONG_SCALE = 0xfffffffffffffff

const NULL_VALUES_ALLOWED_OPERATORS = ['is_not']
class ClientError extends Error {
  constructor(message: string) {
    super()
    Error.captureStackTrace(this, this.constructor)
    this.name = 'ClientError'
    this.message = message
    Object.setPrototypeOf(this, ClientError.prototype)
  }
}

class InconclusiveMatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
    // instanceof doesn't work in ES3 or ES5
    // https://www.dannyguo.com/blog/how-to-fix-instanceof-not-working-for-custom-errors-in-typescript/
    // this is the workaround
    Object.setPrototypeOf(this, InconclusiveMatchError.prototype)
  }
}

class RequiresServerEvaluation extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
    // instanceof doesn't work in ES3 or ES5
    // https://www.dannyguo.com/blog/how-to-fix-instanceof-not-working-for-custom-errors-in-typescript/
    // this is the workaround
    Object.setPrototypeOf(this, RequiresServerEvaluation.prototype)
  }
}

type FeatureFlagsPollerOptions = {
  personalApiKey: string
  projectApiKey: string
  host: string
  pollingInterval: number
  timeout?: number
  fetch?: (url: string, options: PostHogFetchOptions) => Promise<PostHogFetchResponse>
  onError?: (error: Error) => void
  onLoad?: (count: number) => void
  customHeaders?: { [key: string]: string }
  cacheProvider?: FlagDefinitionCacheProvider
  strictLocalEvaluation?: boolean
}

class FeatureFlagsPoller {
  pollingInterval: number
  personalApiKey: string
  projectApiKey: string
  featureFlags: Array<PostHogFeatureFlag>
  featureFlagsByKey: Record<string, PostHogFeatureFlag>
  groupTypeMapping: Record<string, string>
  cohorts: Record<string, PropertyGroup>
  loadedSuccessfullyOnce: boolean
  timeout?: number
  host: FeatureFlagsPollerOptions['host']
  poller?: NodeJS.Timeout
  fetch: (url: string, options: PostHogFetchOptions) => Promise<PostHogFetchResponse>
  debugMode: boolean = false
  onError?: (error: Error) => void
  customHeaders?: { [key: string]: string }
  shouldBeginExponentialBackoff: boolean = false
  backOffCount: number = 0
  onLoad?: (count: number) => void
  private cacheProvider?: FlagDefinitionCacheProvider
  private loadingPromise?: Promise<void>
  private flagsEtag?: string
  private nextFetchAllowedAt?: number
  private strictLocalEvaluation: boolean

  constructor({
    pollingInterval,
    personalApiKey,
    projectApiKey,
    timeout,
    host,
    customHeaders,
    ...options
  }: FeatureFlagsPollerOptions) {
    this.pollingInterval = pollingInterval
    this.personalApiKey = personalApiKey
    this.featureFlags = []
    this.featureFlagsByKey = {}
    this.groupTypeMapping = {}
    this.cohorts = {}
    this.loadedSuccessfullyOnce = false
    this.timeout = timeout
    this.projectApiKey = projectApiKey
    this.host = host
    this.poller = undefined
    this.fetch = options.fetch || fetch
    this.onError = options.onError
    this.customHeaders = customHeaders
    this.onLoad = options.onLoad
    this.cacheProvider = options.cacheProvider
    this.strictLocalEvaluation = options.strictLocalEvaluation ?? false
    void this.loadFeatureFlags()
  }

  debug(enabled: boolean = true): void {
    this.debugMode = enabled
  }

  private logMsgIfDebug(fn: () => void): void {
    if (this.debugMode) {
      fn()
    }
  }

  async getFeatureFlag(
    key: string,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {}
  ): Promise<FeatureFlagValue | undefined> {
    await this.loadFeatureFlags()

    let response: FeatureFlagValue | undefined = undefined
    let featureFlag = undefined

    if (!this.loadedSuccessfullyOnce) {
      return response
    }

    featureFlag = this.featureFlagsByKey[key]

    if (featureFlag !== undefined) {
      try {
        const result = await this.computeFlagAndPayloadLocally(
          featureFlag,
          distinctId,
          groups,
          personProperties,
          groupProperties
        )
        response = result.value
        this.logMsgIfDebug(() => console.debug(`Successfully computed flag locally: ${key} -> ${response}`))
      } catch (e) {
        if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError) {
          this.logMsgIfDebug(() => console.debug(`${e.name} when computing flag locally: ${key}: ${e.message}`))
        } else if (e instanceof Error) {
          this.onError?.(new Error(`Error computing flag locally: ${key}: ${e}`))
        }
      }
    }

    return response
  }

  async getAllFlagsAndPayloads(
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    flagKeysToExplicitlyEvaluate?: string[]
  ): Promise<{
    response: Record<string, FeatureFlagValue>
    payloads: Record<string, JsonType>
    fallbackToFlags: boolean
  }> {
    await this.loadFeatureFlags()

    const response: Record<string, FeatureFlagValue> = {}
    const payloads: Record<string, JsonType> = {}
    let fallbackToFlags = this.featureFlags.length == 0

    const flagsToEvaluate = flagKeysToExplicitlyEvaluate
      ? flagKeysToExplicitlyEvaluate.map((key) => this.featureFlagsByKey[key]).filter(Boolean)
      : this.featureFlags

    // Create a shared evaluation cache to prevent memory leaks when processing many flags
    const sharedEvaluationCache: Record<string, FeatureFlagValue> = {}

    await Promise.all(
      flagsToEvaluate.map(async (flag) => {
        try {
          const { value: matchValue, payload: matchPayload } = await this.computeFlagAndPayloadLocally(
            flag,
            distinctId,
            groups,
            personProperties,
            groupProperties,
            undefined /* matchValue */,
            sharedEvaluationCache
          )
          response[flag.key] = matchValue
          if (matchPayload) {
            payloads[flag.key] = matchPayload
          }
        } catch (e) {
          if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError) {
            this.logMsgIfDebug(() => console.debug(`${e.name} when computing flag locally: ${flag.key}: ${e.message}`))
          } else if (e instanceof Error) {
            this.onError?.(new Error(`Error computing flag locally: ${flag.key}: ${e}`))
          }
          fallbackToFlags = true
        }
      })
    )

    return { response, payloads, fallbackToFlags }
  }

  async computeFlagAndPayloadLocally(
    flag: PostHogFeatureFlag,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    matchValue?: FeatureFlagValue,
    evaluationCache?: Record<string, FeatureFlagValue>,
    skipLoadCheck: boolean = false
  ): Promise<{
    value: FeatureFlagValue
    payload: JsonType | null
  }> {
    // Only load flags if not already loaded and not skipping the check
    if (!skipLoadCheck) {
      await this.loadFeatureFlags()
    }

    if (!this.loadedSuccessfullyOnce) {
      return { value: false, payload: null }
    }

    let flagValue: FeatureFlagValue

    // If matchValue is provided, use it directly; otherwise evaluate the flag
    if (matchValue !== undefined) {
      flagValue = matchValue
    } else {
      flagValue = await this.computeFlagValueLocally(
        flag,
        distinctId,
        groups,
        personProperties,
        groupProperties,
        evaluationCache
      )
    }

    // Always compute payload based on the final flagValue (whether provided or computed)
    const payload = this.getFeatureFlagPayload(flag.key, flagValue)

    return { value: flagValue, payload }
  }

  private async computeFlagValueLocally(
    flag: PostHogFeatureFlag,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    evaluationCache: Record<string, FeatureFlagValue> = {}
  ): Promise<FeatureFlagValue> {
    if (flag.ensure_experience_continuity) {
      throw new InconclusiveMatchError('Flag has experience continuity enabled')
    }

    if (!flag.active) {
      return false
    }

    const flagFilters = flag.filters || {}
    const aggregation_group_type_index = flagFilters.aggregation_group_type_index

    if (aggregation_group_type_index != undefined) {
      const groupName = this.groupTypeMapping[String(aggregation_group_type_index)]

      if (!groupName) {
        this.logMsgIfDebug(() =>
          console.warn(
            `[FEATURE FLAGS] Unknown group type index ${aggregation_group_type_index} for feature flag ${flag.key}`
          )
        )
        throw new InconclusiveMatchError('Flag has unknown group type index')
      }

      if (!(groupName in groups)) {
        this.logMsgIfDebug(() =>
          console.warn(`[FEATURE FLAGS] Can't compute group feature flag: ${flag.key} without group names passed in`)
        )
        return false
      }

      const focusedGroupProperties = groupProperties[groupName]
      return await this.matchFeatureFlagProperties(flag, groups[groupName], focusedGroupProperties, evaluationCache)
    } else {
      return await this.matchFeatureFlagProperties(flag, distinctId, personProperties, evaluationCache)
    }
  }

  private getFeatureFlagPayload(key: string, flagValue: FeatureFlagValue): JsonType | null {
    let payload: JsonType | null = null

    if (flagValue !== false && flagValue !== null && flagValue !== undefined) {
      if (typeof flagValue == 'boolean') {
        payload = this.featureFlagsByKey?.[key]?.filters?.payloads?.[flagValue.toString()] || null
      } else if (typeof flagValue == 'string') {
        payload = this.featureFlagsByKey?.[key]?.filters?.payloads?.[flagValue] || null
      }

      if (payload !== null && payload !== undefined) {
        // If payload is already an object, return it directly
        if (typeof payload === 'object') {
          return payload
        }
        // If payload is a string, try to parse it as JSON
        if (typeof payload === 'string') {
          try {
            return JSON.parse(payload)
          } catch {
            // If parsing fails, return the string as is
            return payload
          }
        }
        // For other types, return as is
        return payload
      }
    }
    return null
  }

  private async evaluateFlagDependency(
    property: FlagProperty,
    distinctId: string,
    properties: Record<string, string>,
    evaluationCache: Record<string, FeatureFlagValue>
  ): Promise<boolean> {
    const targetFlagKey = property.key

    if (!this.featureFlagsByKey) {
      throw new InconclusiveMatchError('Feature flags not available for dependency evaluation')
    }

    // Check if dependency_chain is present - it should always be provided for flag dependencies
    if (!('dependency_chain' in property)) {
      throw new InconclusiveMatchError(
        `Flag dependency property for '${targetFlagKey}' is missing required 'dependency_chain' field`
      )
    }

    const dependencyChain = property.dependency_chain

    // Check for missing or invalid dependency chain (This should never happen, but being defensive)
    if (!Array.isArray(dependencyChain)) {
      throw new InconclusiveMatchError(
        `Flag dependency property for '${targetFlagKey}' has an invalid 'dependency_chain' (expected array, got ${typeof dependencyChain})`
      )
    }

    // Handle circular dependency (empty chain means circular)  (This should never happen, but being defensive)
    if (dependencyChain.length === 0) {
      throw new InconclusiveMatchError(
        `Circular dependency detected for flag '${targetFlagKey}' (empty dependency chain)`
      )
    }

    // Evaluate all dependencies in the chain order
    for (const depFlagKey of dependencyChain) {
      if (!(depFlagKey in evaluationCache)) {
        // Need to evaluate this dependency first
        const depFlag = this.featureFlagsByKey[depFlagKey]
        if (!depFlag) {
          // Missing flag dependency - cannot evaluate locally
          throw new InconclusiveMatchError(`Missing flag dependency '${depFlagKey}' for flag '${targetFlagKey}'`)
        } else if (!depFlag.active) {
          // Inactive flag evaluates to false
          evaluationCache[depFlagKey] = false
        } else {
          // Recursively evaluate the dependency
          try {
            const depResult = await this.matchFeatureFlagProperties(depFlag, distinctId, properties, evaluationCache)
            evaluationCache[depFlagKey] = depResult
          } catch (error) {
            // If we can't evaluate a dependency, store throw InconclusiveMatchError(`Missing flag dependency '${depFlagKey}' for flag '${targetFlagKey}'`)
            throw new InconclusiveMatchError(
              `Error evaluating flag dependency '${depFlagKey}' for flag '${targetFlagKey}': ${error}`
            )
          }
        }
      }

      // Check if dependency evaluation was inconclusive
      const cachedResult = evaluationCache[depFlagKey]
      if (cachedResult === null || cachedResult === undefined) {
        throw new InconclusiveMatchError(`Dependency '${depFlagKey}' could not be evaluated`)
      }
    }

    // The target flag is specified in property.key (This should match the last element in the dependency chain)
    const targetFlagValue = evaluationCache[targetFlagKey]

    return this.flagEvaluatesToExpectedValue(property.value, targetFlagValue)
  }

  private flagEvaluatesToExpectedValue(expectedValue: FlagPropertyValue, flagValue: FeatureFlagValue): boolean {
    // If the expected value is a boolean, then return true if the flag evaluated to true (or any string variant)
    // If the expected value is false, then only return true if the flag evaluated to false.
    if (typeof expectedValue === 'boolean') {
      return (
        expectedValue === flagValue || (typeof flagValue === 'string' && flagValue !== '' && expectedValue === true)
      )
    }

    // If the expected value is a string, then return true if and only if the flag evaluated to the expected value.
    if (typeof expectedValue === 'string') {
      return flagValue === expectedValue
    }

    // The `flag_evaluates_to` operator is not supported for numbers and arrays.
    return false
  }

  async matchFeatureFlagProperties(
    flag: PostHogFeatureFlag,
    distinctId: string,
    properties: Record<string, string>,
    evaluationCache: Record<string, FeatureFlagValue> = {}
  ): Promise<FeatureFlagValue> {
    const flagFilters = flag.filters || {}
    const flagConditions = flagFilters.groups || []
    let isInconclusive = false
    let result = undefined

    for (const condition of flagConditions) {
      try {
        if (await this.isConditionMatch(flag, distinctId, condition, properties, evaluationCache)) {
          const variantOverride = condition.variant
          const flagVariants = flagFilters.multivariate?.variants || []
          if (variantOverride && flagVariants.some((variant) => variant.key === variantOverride)) {
            result = variantOverride
          } else {
            result = (await this.getMatchingVariant(flag, distinctId)) || true
          }
          break
        }
      } catch (e) {
        if (e instanceof RequiresServerEvaluation) {
          // Static cohort or other missing server-side data - must fallback to API
          throw e
        } else if (e instanceof InconclusiveMatchError) {
          // Evaluation error (bad regex, invalid date, missing property, etc.)
          // Track that we had an inconclusive match, but try other conditions
          isInconclusive = true
        } else {
          throw e
        }
      }
    }

    if (result !== undefined) {
      return result
    } else if (isInconclusive) {
      // Had evaluation errors and no successful match - can't determine locally
      throw new InconclusiveMatchError("Can't determine if feature flag is enabled or not with given properties")
    }

    // We can only return False when all conditions are False
    return false
  }

  async isConditionMatch(
    flag: PostHogFeatureFlag,
    distinctId: string,
    condition: FeatureFlagCondition,
    properties: Record<string, string>,
    evaluationCache: Record<string, FeatureFlagValue> = {}
  ): Promise<boolean> {
    const rolloutPercentage = condition.rollout_percentage
    const warnFunction = (msg: string): void => {
      this.logMsgIfDebug(() => console.warn(msg))
    }
    if ((condition.properties || []).length > 0) {
      for (const prop of condition.properties) {
        const propertyType = prop.type
        let matches = false

        if (propertyType === 'cohort') {
          matches = matchCohort(prop, properties, this.cohorts, this.debugMode)
        } else if (propertyType === 'flag') {
          matches = await this.evaluateFlagDependency(prop, distinctId, properties, evaluationCache)
        } else {
          matches = matchProperty(prop, properties, warnFunction)
        }

        if (!matches) {
          return false
        }
      }

      if (rolloutPercentage == undefined) {
        return true
      }
    }

    if (rolloutPercentage != undefined && (await _hash(flag.key, distinctId)) > rolloutPercentage / 100.0) {
      return false
    }

    return true
  }

  async getMatchingVariant(flag: PostHogFeatureFlag, distinctId: string): Promise<FeatureFlagValue | undefined> {
    const hashValue = await _hash(flag.key, distinctId, 'variant')
    const matchingVariant = this.variantLookupTable(flag).find((variant) => {
      return hashValue >= variant.valueMin && hashValue < variant.valueMax
    })

    if (matchingVariant) {
      return matchingVariant.key
    }
    return undefined
  }

  variantLookupTable(flag: PostHogFeatureFlag): { valueMin: number; valueMax: number; key: string }[] {
    const lookupTable: { valueMin: number; valueMax: number; key: string }[] = []
    let valueMin = 0
    let valueMax = 0
    const flagFilters = flag.filters || {}
    const multivariates: {
      key: string
      rollout_percentage: number
    }[] = flagFilters.multivariate?.variants || []

    multivariates.forEach((variant) => {
      valueMax = valueMin + variant.rollout_percentage / 100.0
      lookupTable.push({ valueMin, valueMax, key: variant.key })
      valueMin = valueMax
    })
    return lookupTable
  }

  /**
   * Updates the internal flag state with the provided flag data.
   */
  private updateFlagState(flagData: FlagDefinitionCacheData): void {
    this.featureFlags = flagData.flags
    this.featureFlagsByKey = flagData.flags.reduce(
      (acc, curr) => ((acc[curr.key] = curr), acc),
      <Record<string, PostHogFeatureFlag>>{}
    )
    this.groupTypeMapping = flagData.groupTypeMapping
    this.cohorts = flagData.cohorts
    this.loadedSuccessfullyOnce = true
  }

  /**
   * Warn about flags that cannot be evaluated locally.
   * Called after loading flag definitions when local evaluation is enabled.
   * Only warns if strictLocalEvaluation is NOT enabled (when it's enabled, server fallback is already prevented).
   */
  private warnAboutExperienceContinuityFlags(flags: PostHogFeatureFlag[]): void {
    // Don't warn if strictLocalEvaluation is enabled - server fallback is already prevented
    if (this.strictLocalEvaluation) {
      return
    }

    const experienceContinuityFlags = flags.filter((f) => f.ensure_experience_continuity)
    if (experienceContinuityFlags.length > 0) {
      console.warn(
        `[PostHog] You are using local evaluation but ${experienceContinuityFlags.length} flag(s) have experience ` +
          `continuity enabled: ${experienceContinuityFlags.map((f) => f.key).join(', ')}. ` +
          `Experience continuity is incompatible with local evaluation and will cause a server request on every ` +
          `flag evaluation, negating local evaluation cost savings. ` +
          `To avoid server requests and unexpected costs, either disable experience continuity on these flags ` +
          `in PostHog, use strictLocalEvaluation: true in client init, or pass onlyEvaluateLocally: true ` +
          `per flag call (flags that cannot be evaluated locally will return undefined).`
      )
    }
  }

  /**
   * Attempts to load flags from cache and update internal state.
   * Returns true if flags were successfully loaded from cache, false otherwise.
   */
  private async loadFromCache(debugMessage: string): Promise<boolean> {
    if (!this.cacheProvider) {
      return false
    }

    try {
      const cached = await this.cacheProvider.getFlagDefinitions()
      if (cached) {
        this.updateFlagState(cached)
        this.logMsgIfDebug(() => console.debug(`[FEATURE FLAGS] ${debugMessage} (${cached.flags.length} flags)`))
        this.onLoad?.(this.featureFlags.length)
        this.warnAboutExperienceContinuityFlags(cached.flags)
        return true
      }
      return false
    } catch (err) {
      this.onError?.(new Error(`Failed to load from cache: ${err}`))
      return false
    }
  }

  async loadFeatureFlags(forceReload = false): Promise<void> {
    if (this.loadedSuccessfullyOnce && !forceReload) {
      return
    }

    // Respect backoff for on-demand fetches (e.g., from getFeatureFlag calls).
    // The poller uses forceReload=true and has already waited the backoff period.
    if (!forceReload && this.nextFetchAllowedAt && Date.now() < this.nextFetchAllowedAt) {
      this.logMsgIfDebug(() => console.debug('[FEATURE FLAGS] Skipping fetch, in backoff period'))
      return
    }

    if (!this.loadingPromise) {
      this.loadingPromise = this._loadFeatureFlags()
        .catch((err) => this.logMsgIfDebug(() => console.debug(`[FEATURE FLAGS] Failed to load feature flags: ${err}`)))
        .finally(() => {
          this.loadingPromise = undefined
        })
    }

    return this.loadingPromise
  }

  /**
   * Returns true if the feature flags poller has loaded successfully at least once and has more than 0 feature flags.
   * This is useful to check if local evaluation is ready before calling getFeatureFlag.
   */
  isLocalEvaluationReady(): boolean {
    return (this.loadedSuccessfullyOnce ?? false) && (this.featureFlags?.length ?? 0) > 0
  }

  /**
   * If a client is misconfigured with an invalid or improper API key, the polling interval is doubled each time
   * until a successful request is made, up to a maximum of 60 seconds.
   *
   * @returns The polling interval to use for the next request.
   */
  private getPollingInterval(): number {
    if (!this.shouldBeginExponentialBackoff) {
      return this.pollingInterval
    }

    return Math.min(SIXTY_SECONDS, this.pollingInterval * 2 ** this.backOffCount)
  }

  /**
   * Enter backoff state after receiving an error response (401, 403, 429).
   * This enables exponential backoff for the poller and blocks on-demand fetches.
   */
  private beginBackoff(): void {
    this.shouldBeginExponentialBackoff = true
    this.backOffCount += 1
    // Use the same backoff interval as the poller to avoid overwhelming
    // the server with on-demand requests while polling is backed off.
    this.nextFetchAllowedAt = Date.now() + this.getPollingInterval()
  }

  /**
   * Clear backoff state after a successful response (200, 304).
   * This resets the polling interval and allows on-demand fetches immediately.
   */
  private clearBackoff(): void {
    this.shouldBeginExponentialBackoff = false
    this.backOffCount = 0
    this.nextFetchAllowedAt = undefined
  }

  async _loadFeatureFlags(): Promise<void> {
    if (this.poller) {
      clearTimeout(this.poller)
      this.poller = undefined
    }

    this.poller = setTimeout(() => this.loadFeatureFlags(true), this.getPollingInterval())

    try {
      let shouldFetch = true
      if (this.cacheProvider) {
        try {
          shouldFetch = await this.cacheProvider.shouldFetchFlagDefinitions()
        } catch (err) {
          this.onError?.(new Error(`Error in shouldFetchFlagDefinitions: ${err}`))
          // Important: if `shouldFetchFlagDefinitions` throws, we
          // default to fetching.
        }
      }

      if (!shouldFetch) {
        // If we're not supposed to fetch, we assume another instance
        // is handling it. In this case, we'll just reload from cache.
        const loaded = await this.loadFromCache('Loaded flags from cache (skipped fetch)')
        if (loaded) {
          return
        }

        if (this.loadedSuccessfullyOnce) {
          // Respect the decision to not fetch, even if it means
          // keeping stale feature flags.
          return
        }

        // If we've gotten here:
        // - A cache provider is configured
        // - We've been asked not to fetch
        // - We failed to load from cache
        // - We have no feature flag definitions to work with.
        //
        // This is the only case where we'll ignore the shouldFetch
        // decision and proceed to fetch, because the alternative is
        // worse: local evaluation is impossible.
      }

      const res = await this._requestFeatureFlagDefinitions()

      // Handle undefined res case, this shouldn't happen, but it doesn't hurt to handle it anyway
      if (!res) {
        // Don't override existing flags when something goes wrong
        return
      }

      // NB ON ERROR HANDLING & `loadedSuccessfullyOnce`:
      //
      // `loadedSuccessfullyOnce` indicates we've successfully loaded a valid set of flags at least once.
      // If we set it to `true` in an error scenario (e.g. 402 Over Quota, 401 Invalid Key, etc.),
      // any manual call to `loadFeatureFlags()` (without forceReload) will skip refetching entirely,
      // leaving us stuck with zero or outdated flags. The poller does keep running, but we also want
      // manual reloads to be possible as soon as the error condition is resolved.
      //
      // Therefore, on error statuses, we do *not* set `loadedSuccessfullyOnce = true`, ensuring that
      // both the background poller and any subsequent manual calls can keep trying to load flags
      // once the issue (quota, permission, rate limit, etc.) is resolved.
      switch (res.status) {
        case 304:
          // Not Modified - flags haven't changed, keep using cached data
          this.logMsgIfDebug(() => console.debug('[FEATURE FLAGS] Flags not modified (304), using cached data'))
          // Update ETag if server sent one (304 can include updated ETag per HTTP spec)
          this.flagsEtag = res.headers?.get('ETag') ?? this.flagsEtag
          this.loadedSuccessfullyOnce = true
          this.clearBackoff()
          return

        case 401:
          // Invalid API key
          this.beginBackoff()
          throw new ClientError(
            `Your project key or personal API key is invalid. Setting next polling interval to ${this.getPollingInterval()}ms. More information: https://posthog.com/docs/api#rate-limiting`
          )

        case 402:
          // Quota exceeded - clear all flags
          console.warn(
            '[FEATURE FLAGS] Feature flags quota limit exceeded - unsetting all local flags. Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts'
          )
          this.featureFlags = []
          this.featureFlagsByKey = {}
          this.groupTypeMapping = {}
          this.cohorts = {}
          return

        case 403:
          // Permissions issue
          this.beginBackoff()
          throw new ClientError(
            `Your personal API key does not have permission to fetch feature flag definitions for local evaluation. Setting next polling interval to ${this.getPollingInterval()}ms. Are you sure you're using the correct personal and Project API key pair? More information: https://posthog.com/docs/api/overview`
          )

        case 429:
          // Rate limited
          this.beginBackoff()
          throw new ClientError(
            `You are being rate limited. Setting next polling interval to ${this.getPollingInterval()}ms. More information: https://posthog.com/docs/api#rate-limiting`
          )

        case 200: {
          // Process successful response
          const responseJson = ((await res.json()) as { [key: string]: any }) ?? {}
          if (!('flags' in responseJson)) {
            this.onError?.(new Error(`Invalid response when getting feature flags: ${JSON.stringify(responseJson)}`))
            return
          }

          // Store ETag from response for subsequent conditional requests
          // Clear it if server stops sending one
          this.flagsEtag = res.headers?.get('ETag') ?? undefined

          const flagData: FlagDefinitionCacheData = {
            flags: (responseJson.flags as PostHogFeatureFlag[]) ?? [],
            groupTypeMapping: (responseJson.group_type_mapping as Record<string, string>) || {},
            cohorts: (responseJson.cohorts as Record<string, PropertyGroup>) || {},
          }

          this.updateFlagState(flagData)
          this.clearBackoff()

          if (this.cacheProvider && shouldFetch) {
            // Only notify the cache if it's actually expecting new data
            // E.g., if we weren't supposed to fetch but we missed the
            // cache, we may not have a lock, so we skip this step
            try {
              await this.cacheProvider.onFlagDefinitionsReceived(flagData)
            } catch (err) {
              this.onError?.(new Error(`Failed to store in cache: ${err}`))
              // Continue anyway, the data at least made it to memory
            }
          }

          this.onLoad?.(this.featureFlags.length)
          this.warnAboutExperienceContinuityFlags(flagData.flags)
          break
        }

        default:
          // Something else went wrong, or the server is down.
          // In this case, don't override existing flags
          return
      }
    } catch (err) {
      if (err instanceof ClientError) {
        this.onError?.(err)
      }
    }
  }

  private getPersonalApiKeyRequestOptions(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
    etag?: string
  ): PostHogFetchOptions {
    const headers: { [key: string]: string } = {
      ...this.customHeaders,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.personalApiKey}`,
    }

    if (etag) {
      headers['If-None-Match'] = etag
    }

    return {
      method,
      headers,
    }
  }

  _requestFeatureFlagDefinitions(): Promise<PostHogFetchResponse> {
    const url = `${this.host}/api/feature_flag/local_evaluation?token=${this.projectApiKey}&send_cohorts`

    const options = this.getPersonalApiKeyRequestOptions('GET', this.flagsEtag)

    let abortTimeout = null

    if (this.timeout && typeof this.timeout === 'number') {
      const controller = new AbortController()
      abortTimeout = safeSetTimeout(() => {
        controller.abort()
      }, this.timeout)
      options.signal = controller.signal
    }

    try {
      // Unbind fetch from `this` to avoid potential issues in edge environments, e.g., Cloudflare Workers:
      // https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors
      const fetch = this.fetch
      return fetch(url, options)
    } finally {
      clearTimeout(abortTimeout)
    }
  }

  async stopPoller(timeoutMs: number = 30000): Promise<void> {
    clearTimeout(this.poller)

    if (this.cacheProvider) {
      try {
        const shutdownResult = this.cacheProvider.shutdown()

        if (shutdownResult instanceof Promise) {
          // This follows the same timeout logic defined in _shutdown.
          // We time out after some period of time to avoid hanging the entire
          // shutdown process if the cache provider misbehaves.
          await Promise.race([
            shutdownResult,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Cache shutdown timeout after ${timeoutMs}ms`)), timeoutMs)
            ),
          ])
        }
      } catch (err) {
        this.onError?.(new Error(`Error during cache shutdown: ${err}`))
      }
    }
  }
}

// # This function takes a distinct_id and a feature flag key and returns a float between 0 and 1.
// # Given the same distinct_id and key, it'll always return the same float. These floats are
// # uniformly distributed between 0 and 1, so if we want to show this feature to 20% of traffic
// # we can do _hash(key, distinct_id) < 0.2
async function _hash(key: string, distinctId: string, salt: string = ''): Promise<number> {
  const hashString = await hashSHA1(`${key}.${distinctId}${salt}`)
  return parseInt(hashString.slice(0, 15), 16) / LONG_SCALE
}

function matchProperty(
  property: FeatureFlagCondition['properties'][number],
  propertyValues: Record<string, any>,
  warnFunction?: (msg: string) => void
): boolean {
  const key = property.key
  const value = property.value
  const operator = property.operator || 'exact'

  if (!(key in propertyValues)) {
    throw new InconclusiveMatchError(`Property ${key} not found in propertyValues`)
  } else if (operator === 'is_not_set') {
    throw new InconclusiveMatchError(`Operator is_not_set is not supported`)
  }

  const overrideValue = propertyValues[key]
  if (overrideValue == null && !NULL_VALUES_ALLOWED_OPERATORS.includes(operator)) {
    // if the value is null, just fail the feature flag comparison
    // this isn't an InconclusiveMatchError because the property value was provided.
    if (warnFunction) {
      warnFunction(`Property ${key} cannot have a value of null/undefined with the ${operator} operator`)
    }

    return false
  }

  function computeExactMatch(value: any, overrideValue: any): boolean {
    if (Array.isArray(value)) {
      return value.map((val) => String(val).toLowerCase()).includes(String(overrideValue).toLowerCase())
    }
    return String(value).toLowerCase() === String(overrideValue).toLowerCase()
  }

  function compare(lhs: any, rhs: any, operator: string): boolean {
    if (operator === 'gt') {
      return lhs > rhs
    } else if (operator === 'gte') {
      return lhs >= rhs
    } else if (operator === 'lt') {
      return lhs < rhs
    } else if (operator === 'lte') {
      return lhs <= rhs
    } else {
      throw new Error(`Invalid operator: ${operator}`)
    }
  }

  switch (operator) {
    case 'exact':
      return computeExactMatch(value, overrideValue)
    case 'is_not':
      return !computeExactMatch(value, overrideValue)
    case 'is_set':
      return key in propertyValues
    case 'icontains':
      return String(overrideValue).toLowerCase().includes(String(value).toLowerCase())
    case 'not_icontains':
      return !String(overrideValue).toLowerCase().includes(String(value).toLowerCase())
    case 'regex':
      return isValidRegex(String(value)) && String(overrideValue).match(String(value)) !== null
    case 'not_regex':
      return isValidRegex(String(value)) && String(overrideValue).match(String(value)) === null
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // :TRICKY: We adjust comparison based on the override value passed in,
      // to make sure we handle both numeric and string comparisons appropriately.
      let parsedValue = typeof value === 'number' ? value : null

      if (typeof value === 'string') {
        try {
          parsedValue = parseFloat(value)
        } catch (err) {
          // pass
        }
      }

      if (parsedValue != null && overrideValue != null) {
        // check both null and undefined
        if (typeof overrideValue === 'string') {
          return compare(overrideValue, String(value), operator)
        } else {
          return compare(overrideValue, parsedValue, operator)
        }
      } else {
        return compare(String(overrideValue), String(value), operator)
      }
    }
    case 'is_date_after':
    case 'is_date_before': {
      // Boolean values should never be used with date operations
      if (typeof value === 'boolean') {
        throw new InconclusiveMatchError(`Date operations cannot be performed on boolean values`)
      }

      let parsedDate = relativeDateParseForFeatureFlagMatching(String(value))
      if (parsedDate == null) {
        parsedDate = convertToDateTime(value)
      }

      if (parsedDate == null) {
        throw new InconclusiveMatchError(`Invalid date: ${value}`)
      }
      const overrideDate = convertToDateTime(overrideValue)
      if (['is_date_before'].includes(operator)) {
        return overrideDate < parsedDate
      }
      return overrideDate > parsedDate
    }
    default:
      throw new InconclusiveMatchError(`Unknown operator: ${operator}`)
  }
}

function checkCohortExists(cohortId: string, cohortProperties: FeatureFlagsPoller['cohorts']): void {
  if (!(cohortId in cohortProperties)) {
    throw new RequiresServerEvaluation(
      `cohort ${cohortId} not found in local cohorts - likely a static cohort that requires server evaluation`
    )
  }
}

function matchCohort(
  property: FeatureFlagCondition['properties'][number],
  propertyValues: Record<string, any>,
  cohortProperties: FeatureFlagsPoller['cohorts'],
  debugMode: boolean = false
): boolean {
  const cohortId = String(property.value)
  checkCohortExists(cohortId, cohortProperties)

  const propertyGroup = cohortProperties[cohortId]
  return matchPropertyGroup(propertyGroup, propertyValues, cohortProperties, debugMode)
}

function matchPropertyGroup(
  propertyGroup: PropertyGroup,
  propertyValues: Record<string, any>,
  cohortProperties: FeatureFlagsPoller['cohorts'],
  debugMode: boolean = false
): boolean {
  if (!propertyGroup) {
    return true
  }

  const propertyGroupType = propertyGroup.type
  const properties = propertyGroup.values

  if (!properties || properties.length === 0) {
    // empty groups are no-ops, always match
    return true
  }

  let errorMatchingLocally = false

  if ('values' in properties[0]) {
    // a nested property group
    for (const prop of properties as PropertyGroup[]) {
      try {
        const matches = matchPropertyGroup(prop, propertyValues, cohortProperties, debugMode)
        if (propertyGroupType === 'AND') {
          if (!matches) {
            return false
          }
        } else {
          // OR group
          if (matches) {
            return true
          }
        }
      } catch (err) {
        if (err instanceof RequiresServerEvaluation) {
          // Immediately propagate - this condition requires server-side data
          throw err
        } else if (err instanceof InconclusiveMatchError) {
          if (debugMode) {
            console.debug(`Failed to compute property ${prop} locally: ${err}`)
          }
          errorMatchingLocally = true
        } else {
          throw err
        }
      }
    }

    if (errorMatchingLocally) {
      throw new InconclusiveMatchError("Can't match cohort without a given cohort property value")
    }
    // if we get here, all matched in AND case, or none matched in OR case
    return propertyGroupType === 'AND'
  } else {
    for (const prop of properties as FlagProperty[]) {
      try {
        let matches: boolean
        if (prop.type === 'cohort') {
          matches = matchCohort(prop, propertyValues, cohortProperties, debugMode)
        } else if (prop.type === 'flag') {
          if (debugMode) {
            console.warn(
              `[FEATURE FLAGS] Flag dependency filters are not supported in local evaluation. ` +
                `Skipping condition with dependency on flag '${prop.key || 'unknown'}'`
            )
          }
          continue
        } else {
          matches = matchProperty(prop, propertyValues)
        }

        const negation = prop.negation || false

        if (propertyGroupType === 'AND') {
          // if negated property, do the inverse
          if (!matches && !negation) {
            return false
          }
          if (matches && negation) {
            return false
          }
        } else {
          // OR group
          if (matches && !negation) {
            return true
          }
          if (!matches && negation) {
            return true
          }
        }
      } catch (err) {
        if (err instanceof RequiresServerEvaluation) {
          // Immediately propagate - this condition requires server-side data
          throw err
        } else if (err instanceof InconclusiveMatchError) {
          if (debugMode) {
            console.debug(`Failed to compute property ${prop} locally: ${err}`)
          }
          errorMatchingLocally = true
        } else {
          throw err
        }
      }
    }

    if (errorMatchingLocally) {
      throw new InconclusiveMatchError("can't match cohort without a given cohort property value")
    }

    // if we get here, all matched in AND case, or none matched in OR case
    return propertyGroupType === 'AND'
  }
}

function isValidRegex(regex: string): boolean {
  try {
    new RegExp(regex)
    return true
  } catch (err) {
    return false
  }
}

function convertToDateTime(value: FlagPropertyValue | Date): Date {
  if (value instanceof Date) {
    return value
  } else if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!isNaN(date.valueOf())) {
      return date
    }
    throw new InconclusiveMatchError(`${value} is in an invalid date format`)
  } else {
    throw new InconclusiveMatchError(`The date provided ${value} must be a string, number, or date object`)
  }
}

function relativeDateParseForFeatureFlagMatching(value: string): Date | null {
  const regex = /^-?(?<number>[0-9]+)(?<interval>[a-z])$/
  const match = value.match(regex)
  const parsedDt = new Date(new Date().toISOString())

  if (match) {
    if (!match.groups) {
      return null
    }

    const number = parseInt(match.groups['number'])

    if (number >= 10000) {
      // Guard against overflow, disallow numbers greater than 10_000
      return null
    }
    const interval = match.groups['interval']
    if (interval == 'h') {
      parsedDt.setUTCHours(parsedDt.getUTCHours() - number)
    } else if (interval == 'd') {
      parsedDt.setUTCDate(parsedDt.getUTCDate() - number)
    } else if (interval == 'w') {
      parsedDt.setUTCDate(parsedDt.getUTCDate() - number * 7)
    } else if (interval == 'm') {
      parsedDt.setUTCMonth(parsedDt.getUTCMonth() - number)
    } else if (interval == 'y') {
      parsedDt.setUTCFullYear(parsedDt.getUTCFullYear() - number)
    } else {
      return null
    }

    return parsedDt
  } else {
    return null
  }
}

export {
  FeatureFlagsPoller,
  matchProperty,
  relativeDateParseForFeatureFlagMatching,
  InconclusiveMatchError,
  RequiresServerEvaluation,
  ClientError,
}
