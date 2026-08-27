import { FeatureFlagCondition, FlagProperty, FlagPropertyValue, PostHogFeatureFlag, PropertyGroup } from '../../types'
import type { FeatureFlagValue, JsonType, PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'
import {
  getFeatureFlagHash,
  getFeatureFlagVariant,
  getFeatureFlagVariantLookupTable,
  InconclusiveMatchError,
  matchFeatureFlagProperty,
  parseFeatureFlagSemver,
  raceWithTimeout,
  relativeDateParseForFeatureFlagMatching,
  resolveFeatureFlagPayload,
  safeSetTimeout,
} from '@posthog/core'
import { FlagDefinitionCacheProvider, FlagDefinitionCacheData } from './cache'

const SIXTY_SECONDS = 60 * 1000

// Outcome of evaluating a single condition group. `out_of_rollout_bound` means the group's property
// filters matched (or there were none) but the rollout percentage excluded the user — the only case
// that triggers a flag's `early_exit` short-circuit.
type ConditionMatchResult = 'match' | 'no_match' | 'out_of_rollout_bound'

class ClientError extends Error {
  constructor(message: string) {
    super()
    Error.captureStackTrace(this, this.constructor)
    this.name = 'ClientError'
    this.message = message
    Object.setPrototypeOf(this, ClientError.prototype)
  }
}

function setCustomErrorPrototype(error: Error, constructor: new (message: string) => Error): void {
  error.name = constructor.name
  Error.captureStackTrace(error, constructor)
  // instanceof doesn't work in ES3 or ES5
  // https://www.dannyguo.com/blog/how-to-fix-instanceof-not-working-for-custom-errors-in-typescript/
  // this is the workaround
  Object.setPrototypeOf(error, constructor.prototype)
}

class RequiresServerEvaluation extends Error {
  constructor(message: string) {
    super(message)
    setCustomErrorPrototype(this, RequiresServerEvaluation)
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
  /**
   * Called whenever flag definitions are (re)loaded — from the API, the cache provider, or a
   * quota reset — with the server gate for minimal `$feature_flag_called` events carried by
   * that payload. Lets the client keep a single last-writer-wins gate across the local-eval
   * and remote `/flags` signal sources.
   */
  onMinimalFlagCalledEvents?: (enabled: boolean) => void
  customHeaders?: { [key: string]: string }
  cacheProvider?: FlagDefinitionCacheProvider
  strictLocalEvaluation?: boolean
}

export type FeatureFlagEvaluationContext = {
  distinctId: string
  groups: Record<string, string>
  personProperties: Record<string, any>
  groupProperties: Record<string, Record<string, any>>
  evaluationCache: Record<string, FeatureFlagValue>
}

type ComputeFlagAndPayloadOptions = {
  matchValue?: FeatureFlagValue
  skipLoadCheck?: boolean
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
  private pollerStopped: boolean = false
  private flagsEtag?: string
  private nextFetchAllowedAt?: number
  private strictLocalEvaluation: boolean
  private flagDefinitionsLoadedAt?: number
  private onMinimalFlagCalledEvents?: (enabled: boolean) => void

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
    this.onMinimalFlagCalledEvents = options.onMinimalFlagCalledEvents
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

  private createEvaluationContext(
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, any> = {},
    groupProperties: Record<string, Record<string, any>> = {},
    evaluationCache: Record<string, FeatureFlagValue> = {}
  ): FeatureFlagEvaluationContext {
    return {
      distinctId,
      groups,
      personProperties,
      groupProperties,
      evaluationCache,
    }
  }

  async getFeatureFlag(
    key: string,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, any> = {},
    groupProperties: Record<string, Record<string, any>> = {}
  ): Promise<FeatureFlagValue | undefined> {
    await this.loadFeatureFlags()

    let response: FeatureFlagValue | undefined = undefined
    let featureFlag = undefined

    if (!this.loadedSuccessfullyOnce) {
      return response
    }

    featureFlag = this.featureFlagsByKey[key]

    if (featureFlag !== undefined) {
      const evaluationContext = this.createEvaluationContext(distinctId, groups, personProperties, groupProperties)
      try {
        const result = await this.computeFlagAndPayloadLocally(featureFlag, evaluationContext)
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
    evaluationContext: FeatureFlagEvaluationContext,
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

    const sharedEvaluationContext = {
      ...evaluationContext,
      evaluationCache: evaluationContext.evaluationCache ?? {},
    }

    await Promise.all(
      flagsToEvaluate.map(async (flag) => {
        try {
          const { value: matchValue, payload: matchPayload } = await this.computeFlagAndPayloadLocally(
            flag,
            sharedEvaluationContext
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
    evaluationContext: FeatureFlagEvaluationContext,
    options: ComputeFlagAndPayloadOptions = {}
  ): Promise<{
    value: FeatureFlagValue
    payload: JsonType | null
  }> {
    const { matchValue, skipLoadCheck = false } = options

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
      flagValue = await this.computeFlagValueLocally(flag, evaluationContext)
    }

    // Always compute payload based on the final flagValue (whether provided or computed)
    const payload = this.getFeatureFlagPayload(flag.key, flagValue)

    return { value: flagValue, payload }
  }

  private async computeFlagValueLocally(
    flag: PostHogFeatureFlag,
    evaluationContext: FeatureFlagEvaluationContext
  ): Promise<FeatureFlagValue> {
    const { distinctId, groups, personProperties, groupProperties } = evaluationContext

    // Order matters: an inactive flag is always false regardless of continuity. Checking
    // `ensure_experience_continuity` first would cause a disabled-but-continuity flag to come
    // back as undefined instead of the correct `false`.
    if (!flag.active) {
      return false
    }

    if (flag.ensure_experience_continuity) {
      throw new InconclusiveMatchError('Flag has experience continuity enabled')
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

      if (
        flag.bucketing_identifier === 'device_id' &&
        (personProperties?.$device_id === undefined ||
          personProperties?.$device_id === null ||
          personProperties?.$device_id === '')
      ) {
        this.logMsgIfDebug(() =>
          console.warn(`[FEATURE FLAGS] Ignoring bucketing_identifier for group flag: ${flag.key}`)
        )
      }

      const focusedGroupProperties = groupProperties[groupName]
      return await this.matchFeatureFlagProperties(flag, groups[groupName], focusedGroupProperties, evaluationContext)
    } else {
      const bucketingValue = this.getBucketingValueForFlag(flag, distinctId, personProperties)
      if (bucketingValue === undefined) {
        this.logMsgIfDebug(() =>
          console.warn(
            `[FEATURE FLAGS] Can't compute feature flag: ${flag.key} without $device_id, falling back to server evaluation`
          )
        )
        throw new InconclusiveMatchError(`Can't compute feature flag: ${flag.key} without $device_id`)
      }
      return await this.matchFeatureFlagProperties(flag, bucketingValue, personProperties, evaluationContext)
    }
  }

  private getBucketingValueForFlag(
    flag: PostHogFeatureFlag,
    distinctId: string,
    properties: Record<string, any>
  ): string | undefined {
    if (flag.filters?.aggregation_group_type_index != undefined) {
      // Group flags are bucketed by group key in computeFlagValueLocally.
      // If a group flag appears in dependency evaluation, ignore bucketing_identifier
      // to preserve existing behavior and avoid requiring $device_id unexpectedly.
      return distinctId
    }

    if (flag.bucketing_identifier === 'device_id') {
      const deviceId = properties?.$device_id
      if (deviceId === undefined || deviceId === null || deviceId === '') {
        return undefined
      }
      return deviceId
    }

    return distinctId
  }

  private getFeatureFlagPayload(key: string, flagValue: FeatureFlagValue): JsonType | null {
    return resolveFeatureFlagPayload(this.featureFlagsByKey?.[key]?.filters?.payloads, flagValue)
  }

  private async evaluateFlagDependency(
    property: FlagProperty,
    properties: Record<string, any>,
    evaluationContext: FeatureFlagEvaluationContext
  ): Promise<boolean> {
    const { evaluationCache } = evaluationContext
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
          // Reuse full flag evaluation so dependencies respect person vs group bucketing rules.
          try {
            const depResult = await this.computeFlagValueLocally(depFlag, evaluationContext)
            evaluationCache[depFlagKey] = depResult
          } catch (error) {
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
    bucketingValue: string,
    properties: Record<string, any>,
    evaluationContext: FeatureFlagEvaluationContext
  ): Promise<FeatureFlagValue> {
    const flagFilters = flag.filters || {}
    const flagConditions = flagFilters.groups || []
    const flagAggregation = flagFilters.aggregation_group_type_index
    const earlyExitEnabled = flagFilters.early_exit ?? false
    const { groups, groupProperties } = evaluationContext
    let isInconclusive = false
    let result = undefined

    for (const condition of flagConditions) {
      try {
        // Per-condition aggregation overrides only when the condition explicitly
        // sets its own aggregation_group_type_index (mixed targeting).
        // When absent, use the properties/bucketing already resolved by the caller.
        const conditionAggregation =
          condition.aggregation_group_type_index !== undefined
            ? condition.aggregation_group_type_index
            : flagAggregation

        let effectiveProperties = properties
        let effectiveBucketingValue = bucketingValue

        // Mixed-override path: condition-level aggregation differs from flag-level.
        // This assumes flag-level aggregation is null/undefined for mixed flags.
        if (conditionAggregation !== flagAggregation) {
          if (conditionAggregation !== null && conditionAggregation !== undefined) {
            const groupName = this.groupTypeMapping[String(conditionAggregation)]
            if (!groupName || !(groupName in groups)) {
              this.logMsgIfDebug(() =>
                console.debug(
                  `[FEATURE FLAGS] Skipping group condition for flag '${flag.key}': group type index ${conditionAggregation} not available`
                )
              )
              continue
            }
            if (!(groupName in groupProperties)) {
              isInconclusive = true
              continue
            }
            effectiveProperties = groupProperties[groupName]
            effectiveBucketingValue = groups[groupName]
          }
        }

        const matchResult = await this.isConditionMatch(
          flag,
          effectiveBucketingValue,
          condition,
          effectiveProperties,
          evaluationContext
        )
        if (matchResult === 'match') {
          const variantOverride = condition.variant
          const flagVariants = flagFilters.multivariate?.variants || []
          if (variantOverride && flagVariants.some((variant) => variant.key === variantOverride)) {
            result = variantOverride
          } else {
            result = (await this.getMatchingVariant(flag, effectiveBucketingValue)) || true
          }
          break
        } else if (earlyExitEnabled && matchResult === 'out_of_rollout_bound') {
          // The condition's property filters (if any) matched and only the rollout check failed,
          // so re-evaluating later groups can't change the outcome. If an earlier condition was
          // inconclusive, stop here but preserve that result so the caller can fall back remotely.
          if (isInconclusive) {
            break
          }
          return false
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
    bucketingValue: string,
    condition: FeatureFlagCondition,
    properties: Record<string, any>,
    evaluationContext: FeatureFlagEvaluationContext
  ): Promise<ConditionMatchResult> {
    const rolloutPercentage = condition.rollout_percentage
    const warnFunction = (msg: string): void => {
      this.logMsgIfDebug(() => console.warn(msg))
    }
    if ((condition.properties || []).length > 0) {
      for (const prop of condition.properties) {
        const propertyType = prop.type
        let matches = false

        if (propertyType === 'cohort') {
          const inCohort = await matchCohort(prop, properties, this.cohorts, this.debugMode, (depProp) =>
            this.evaluateFlagDependency(depProp, properties, evaluationContext)
          )
          // A flag-level cohort condition carries a membership operator ('in' | 'not_in').
          // `matchCohort` only reports raw membership, so the operator must be applied here.
          // Without this, 'not_in' is silently treated as 'in', inverting any cohort-exclusion
          // condition (e.g. "enabled for everyone NOT in cohort X").
          matches = prop.operator === 'not_in' ? !inCohort : inCohort
        } else if (propertyType === 'flag') {
          matches = await this.evaluateFlagDependency(prop, properties, evaluationContext)
        } else {
          matches = matchProperty(prop, properties, warnFunction)
        }

        if (!matches) {
          return 'no_match'
        }
      }

      if (rolloutPercentage == undefined) {
        return 'match'
      }
    }

    // Property filters (if any) matched; only the rollout check remains. A failure here means the
    // user was targeted but excluded by rollout — the server-side engine's `OutOfRolloutBound`.
    if (
      rolloutPercentage != undefined &&
      (await getFeatureFlagHash(flag.key, bucketingValue)) > rolloutPercentage / 100.0
    ) {
      return 'out_of_rollout_bound'
    }

    return 'match'
  }

  async getMatchingVariant(flag: PostHogFeatureFlag, bucketingValue: string): Promise<FeatureFlagValue | undefined> {
    return getFeatureFlagVariant(flag.key, bucketingValue, flag.filters?.multivariate?.variants || [])
  }

  variantLookupTable(flag: PostHogFeatureFlag): { valueMin: number; valueMax: number; key: string }[] {
    return getFeatureFlagVariantLookupTable(flag.filters?.multivariate?.variants || [])
  }

  /**
   * Updates the internal flag state with the provided flag data.
   */
  private updateFlagState(flagData: FlagDefinitionCacheData): void {
    this.featureFlags = flagData.flags
    this.featureFlagsByKey = flagData.flags.reduce<Record<string, PostHogFeatureFlag>>(
      (acc, curr) => ((acc[curr.key] = curr), acc),
      {}
    )
    this.groupTypeMapping = flagData.groupTypeMapping
    this.cohorts = flagData.cohorts
    this.loadedSuccessfullyOnce = true
    // Absence of the field (older cached data, older servers) always means full events.
    this.onMinimalFlagCalledEvents?.(flagData.minimalFlagCalledEvents === true)
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
   * Returns the timestamp (in milliseconds) when flag definitions were last loaded.
   * Returns undefined if flags have not been loaded yet.
   */
  getFlagDefinitionsLoadedAt(): number | undefined {
    return this.flagDefinitionsLoadedAt
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
            `Your project key or secret key is invalid. Setting next polling interval to ${this.getPollingInterval()}ms. More information: https://posthog.com/docs/api#rate-limiting`
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
          this.onMinimalFlagCalledEvents?.(false)
          return

        case 403:
          // Permissions issue
          this.beginBackoff()
          throw new ClientError(
            `Your secret key does not have permission to fetch feature flag definitions for local evaluation. Setting next polling interval to ${this.getPollingInterval()}ms. Are you sure you're using the correct secret and Project API key pair? More information: https://posthog.com/docs/api/overview`
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
            // Absence of the field always flips the gate off — fail safe to full events.
            minimalFlagCalledEvents: responseJson.minimal_flag_called_events === true,
          }

          this.updateFlagState(flagData)
          // Set timestamp to when definitions were actually fetched from server
          this.flagDefinitionsLoadedAt = Date.now()
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
    } finally {
      if (!this.pollerStopped) {
        this.poller = setTimeout(() => this.loadFeatureFlags(true), this.getPollingInterval())
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

  async _requestFeatureFlagDefinitions(): Promise<PostHogFetchResponse> {
    const url = `${this.host}/flags/definitions?token=${this.projectApiKey}&send_cohorts`

    const options = this.getPersonalApiKeyRequestOptions('GET', this.flagsEtag)

    let abortTimeout = null

    if (this.timeout && typeof this.timeout === 'number') {
      const controller = new AbortController()
      abortTimeout = safeSetTimeout(() => {
        controller.abort()
      }, this.timeout)
      options.signal = controller.signal
    }

    const clearAbortTimeout = () => clearTimeout(abortTimeout)

    try {
      // Unbind fetch from `this` to avoid potential issues in edge environments, e.g., Cloudflare Workers:
      // https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors
      const fetch = this.fetch
      const res = await fetch(url, options)

      if (res.status !== 200) {
        clearAbortTimeout()
        return res
      }

      return {
        status: res.status,
        headers: res.headers,
        body: res.body,
        text: async () => {
          try {
            return await res.text()
          } finally {
            clearAbortTimeout()
          }
        },
        json: async () => {
          try {
            return await res.json()
          } finally {
            clearAbortTimeout()
          }
        },
      }
    } catch (err) {
      clearAbortTimeout()
      throw err
    }
  }

  async stopPoller(timeoutMs: number = 30000): Promise<void> {
    this.pollerStopped = true
    clearTimeout(this.poller)
    this.poller = undefined

    if (this.cacheProvider) {
      try {
        const shutdownResult = this.cacheProvider.shutdown()

        if (shutdownResult instanceof Promise) {
          // This follows the same timeout logic defined in _shutdown.
          // We time out after some period of time to avoid hanging the entire
          // shutdown process if the cache provider misbehaves.
          await raceWithTimeout(shutdownResult, timeoutMs, () => {
            throw new Error(`Cache shutdown timeout after ${timeoutMs}ms`)
          })
        }
      } catch (err) {
        this.onError?.(new Error(`Error during cache shutdown: ${err}`))
      }
    }
  }
}

function matchProperty(
  property: FeatureFlagCondition['properties'][number],
  propertyValues: Record<string, any>,
  warnFunction?: (msg: string) => void
): boolean {
  return matchFeatureFlagProperty(property, propertyValues, { warnFunction })
}

function parseSemver(value: string): [number, number, number] {
  return parseFeatureFlagSemver(value, 'strict')
}

function checkCohortExists(cohortId: string, cohortProperties: FeatureFlagsPoller['cohorts']): void {
  if (!(cohortId in cohortProperties)) {
    throw new RequiresServerEvaluation(
      `cohort ${cohortId} not found in local cohorts - likely a static cohort that requires server evaluation`
    )
  }
}

type FlagDependencyEvaluator = (prop: FlagProperty) => Promise<boolean>

async function matchCohort(
  property: FeatureFlagCondition['properties'][number],
  propertyValues: Record<string, any>,
  cohortProperties: FeatureFlagsPoller['cohorts'],
  debugMode: boolean = false,
  flagDependencyEvaluator?: FlagDependencyEvaluator
): Promise<boolean> {
  const cohortId = String(property.value)
  checkCohortExists(cohortId, cohortProperties)

  const propertyGroup = cohortProperties[cohortId]
  return matchPropertyGroup(propertyGroup, propertyValues, cohortProperties, debugMode, flagDependencyEvaluator)
}

async function matchPropertyGroup(
  propertyGroup: PropertyGroup,
  propertyValues: Record<string, any>,
  cohortProperties: FeatureFlagsPoller['cohorts'],
  debugMode: boolean = false,
  flagDependencyEvaluator?: FlagDependencyEvaluator
): Promise<boolean> {
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
        const matches = await matchPropertyGroup(
          prop,
          propertyValues,
          cohortProperties,
          debugMode,
          flagDependencyEvaluator
        )
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
          matches = await matchCohort(prop, propertyValues, cohortProperties, debugMode, flagDependencyEvaluator)
        } else if (prop.type === 'flag') {
          if (!flagDependencyEvaluator) {
            throw new InconclusiveMatchError(
              `Flag dependency '${prop.key || 'unknown'}' cannot be evaluated without a flag dependency evaluator`
            )
          }
          matches = await flagDependencyEvaluator(prop)
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

export {
  FeatureFlagsPoller,
  matchProperty,
  relativeDateParseForFeatureFlagMatching,
  parseSemver,
  InconclusiveMatchError,
  RequiresServerEvaluation,
  ClientError,
}
