import type {
  FeatureFlagCondition,
  FeatureFlagEvaluationContext,
  FeatureFlagValue,
  FlagDefinitions,
  FlagPropertyValue,
  JsonType,
  PostHogFeatureFlag,
} from './types.js'
import { hashSHA1 } from './crypto.js'
import { InconclusiveMatchError, RequiresServerEvaluation, matchCohort, matchProperty } from './match-property.js'

const LONG_SCALE = 0xfffffffffffffff

async function _hash(key: string, bucketingValue: string, salt: string = ''): Promise<number> {
  const hashString = await hashSHA1(`${key}.${bucketingValue}${salt}`)
  return parseInt(hashString.slice(0, 15), 16) / LONG_SCALE
}

export type EvaluationResult = {
  value: FeatureFlagValue
  payload: JsonType | null
}

export class LocalFeatureFlagEvaluator {
  readonly flags: PostHogFeatureFlag[]
  readonly flagsByKey: Record<string, PostHogFeatureFlag>
  readonly groupTypeMapping: Record<string, string>
  readonly cohorts: FlagDefinitions['cohorts']
  debugMode: boolean = false

  constructor(definitions: FlagDefinitions) {
    this.flags = definitions.flags ?? []
    this.flagsByKey = this.flags.reduce<Record<string, PostHogFeatureFlag>>((acc, flag) => {
      acc[flag.key] = flag
      return acc
    }, {})
    this.groupTypeMapping = definitions.groupTypeMapping ?? {}
    this.cohorts = definitions.cohorts ?? {}
  }

  debug(enabled: boolean = true): void {
    this.debugMode = enabled
  }

  private logMsgIfDebug(fn: () => void): void {
    if (this.debugMode) fn()
  }

  private createEvaluationContext(
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, any> = {},
    groupProperties: Record<string, Record<string, any>> = {}
  ): FeatureFlagEvaluationContext {
    return { distinctId, groups, personProperties, groupProperties, evaluationCache: {} }
  }

  /**
   * Evaluate a single flag locally. Returns the value or `undefined` if eval was inconclusive.
   * `undefined` means the caller has no way to determine the flag value locally — typically
   * because the flag uses experience continuity, a static cohort, or properties that weren't
   * provided.
   */
  async getFeatureFlag(
    key: string,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, any> = {},
    groupProperties: Record<string, Record<string, any>> = {}
  ): Promise<FeatureFlagValue | undefined> {
    const flag = this.flagsByKey[key]
    if (flag === undefined) return undefined

    const ctx = this.createEvaluationContext(distinctId, groups, personProperties, groupProperties)
    try {
      const { value } = await this.computeFlagAndPayloadLocally(flag, ctx)
      return value
    } catch (e) {
      if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError) {
        this.logMsgIfDebug(() =>
          console.debug(`[FEATURE FLAGS] ${(e as Error).name} when computing flag locally: ${key}: ${(e as Error).message}`)
        )
        return undefined
      }
      throw e
    }
  }

  async getFeatureFlagResult(
    key: string,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, any> = {},
    groupProperties: Record<string, Record<string, any>> = {}
  ): Promise<EvaluationResult | undefined> {
    const flag = this.flagsByKey[key]
    if (flag === undefined) return undefined

    const ctx = this.createEvaluationContext(distinctId, groups, personProperties, groupProperties)
    try {
      return await this.computeFlagAndPayloadLocally(flag, ctx)
    } catch (e) {
      if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError) {
        this.logMsgIfDebug(() =>
          console.debug(`[FEATURE FLAGS] ${(e as Error).name} when computing flag locally: ${key}: ${(e as Error).message}`)
        )
        return undefined
      }
      throw e
    }
  }

  async getFeatureFlagPayload(
    key: string,
    distinctId: string,
    matchValue: FeatureFlagValue | undefined,
    groups: Record<string, string> = {},
    personProperties: Record<string, any> = {},
    groupProperties: Record<string, Record<string, any>> = {}
  ): Promise<JsonType | null> {
    const flag = this.flagsByKey[key]
    if (flag === undefined) return null

    if (matchValue !== undefined) {
      return this.getPayloadForValue(key, matchValue)
    }

    const result = await this.getFeatureFlagResult(key, distinctId, groups, personProperties, groupProperties)
    return result?.payload ?? null
  }

  async getAllFlagsAndPayloads(
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, any> = {},
    groupProperties: Record<string, Record<string, any>> = {},
    flagKeys?: string[]
  ): Promise<{ featureFlags: Record<string, FeatureFlagValue>; featureFlagPayloads: Record<string, JsonType> }> {
    const featureFlags: Record<string, FeatureFlagValue> = {}
    const featureFlagPayloads: Record<string, JsonType> = {}

    const flagsToEvaluate = flagKeys ? flagKeys.map((k) => this.flagsByKey[k]).filter(Boolean) : this.flags

    const sharedContext: FeatureFlagEvaluationContext = {
      distinctId,
      groups,
      personProperties,
      groupProperties,
      evaluationCache: {},
    }

    await Promise.all(
      flagsToEvaluate.map(async (flag) => {
        try {
          const { value, payload } = await this.computeFlagAndPayloadLocally(flag, sharedContext)
          featureFlags[flag.key] = value
          if (payload != null) featureFlagPayloads[flag.key] = payload
        } catch (e) {
          if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError) {
            this.logMsgIfDebug(() =>
              console.debug(
                `[FEATURE FLAGS] ${(e as Error).name} when computing flag locally: ${flag.key}: ${(e as Error).message}`
              )
            )
            return
          }
          throw e
        }
      })
    )

    return { featureFlags, featureFlagPayloads }
  }

  async computeFlagAndPayloadLocally(
    flag: PostHogFeatureFlag,
    ctx: FeatureFlagEvaluationContext,
    options: { matchValue?: FeatureFlagValue } = {}
  ): Promise<EvaluationResult> {
    const flagValue = options.matchValue !== undefined ? options.matchValue : await this.computeFlagValueLocally(flag, ctx)
    return { value: flagValue, payload: this.getPayloadForValue(flag.key, flagValue) }
  }

  private async computeFlagValueLocally(
    flag: PostHogFeatureFlag,
    ctx: FeatureFlagEvaluationContext
  ): Promise<FeatureFlagValue> {
    const { distinctId, groups, personProperties, groupProperties } = ctx

    if (flag.ensure_experience_continuity) {
      throw new InconclusiveMatchError('Flag has experience continuity enabled')
    }
    if (!flag.active) return false

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
      return await this.matchFeatureFlagProperties(flag, groups[groupName], focusedGroupProperties, ctx)
    }

    const bucketingValue = this.getBucketingValueForFlag(flag, distinctId, personProperties)
    if (bucketingValue === undefined) {
      this.logMsgIfDebug(() =>
        console.warn(
          `[FEATURE FLAGS] Can't compute feature flag: ${flag.key} without $device_id, falling back to server evaluation`
        )
      )
      throw new InconclusiveMatchError(`Can't compute feature flag: ${flag.key} without $device_id`)
    }
    return await this.matchFeatureFlagProperties(flag, bucketingValue, personProperties, ctx)
  }

  private getBucketingValueForFlag(
    flag: PostHogFeatureFlag,
    distinctId: string,
    properties: Record<string, any>
  ): string | undefined {
    if (flag.filters?.aggregation_group_type_index != undefined) return distinctId
    if (flag.bucketing_identifier === 'device_id') {
      const deviceId = properties?.$device_id
      if (deviceId === undefined || deviceId === null || deviceId === '') return undefined
      return deviceId
    }
    return distinctId
  }

  private getPayloadForValue(key: string, flagValue: FeatureFlagValue): JsonType | null {
    if (flagValue === false || flagValue === null || flagValue === undefined) return null

    let payload: JsonType | null = null
    const payloads = this.flagsByKey[key]?.filters?.payloads
    if (!payloads) return null

    if (typeof flagValue === 'boolean') {
      payload = payloads[flagValue.toString()] || null
    } else if (typeof flagValue === 'string') {
      payload = payloads[flagValue] || null
    }

    if (payload == null) return null
    if (typeof payload === 'object') return payload
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload)
      } catch {
        return payload
      }
    }
    return payload
  }

  private async evaluateFlagDependency(
    property: { key: string; value: FlagPropertyValue; dependency_chain?: string[] },
    ctx: FeatureFlagEvaluationContext
  ): Promise<boolean> {
    const { evaluationCache } = ctx
    const targetFlagKey = property.key

    if (!('dependency_chain' in property)) {
      throw new InconclusiveMatchError(
        `Flag dependency property for '${targetFlagKey}' is missing required 'dependency_chain' field`
      )
    }
    const dependencyChain = property.dependency_chain
    if (!Array.isArray(dependencyChain)) {
      throw new InconclusiveMatchError(
        `Flag dependency property for '${targetFlagKey}' has an invalid 'dependency_chain'`
      )
    }
    if (dependencyChain.length === 0) {
      throw new InconclusiveMatchError(`Circular dependency detected for flag '${targetFlagKey}'`)
    }

    for (const depFlagKey of dependencyChain) {
      if (!(depFlagKey in evaluationCache)) {
        const depFlag = this.flagsByKey[depFlagKey]
        if (!depFlag) {
          throw new InconclusiveMatchError(`Missing flag dependency '${depFlagKey}' for flag '${targetFlagKey}'`)
        }
        if (!depFlag.active) {
          evaluationCache[depFlagKey] = false
        } else {
          try {
            evaluationCache[depFlagKey] = await this.computeFlagValueLocally(depFlag, ctx)
          } catch (error) {
            throw new InconclusiveMatchError(
              `Error evaluating flag dependency '${depFlagKey}' for flag '${targetFlagKey}': ${error}`
            )
          }
        }
      }
      const cached = evaluationCache[depFlagKey]
      if (cached === null || cached === undefined) {
        throw new InconclusiveMatchError(`Dependency '${depFlagKey}' could not be evaluated`)
      }
    }

    return flagEvaluatesToExpectedValue(property.value, evaluationCache[targetFlagKey])
  }

  private async matchFeatureFlagProperties(
    flag: PostHogFeatureFlag,
    bucketingValue: string,
    properties: Record<string, any>,
    ctx: FeatureFlagEvaluationContext
  ): Promise<FeatureFlagValue> {
    const flagFilters = flag.filters || {}
    const flagConditions = flagFilters.groups || []
    const flagAggregation = flagFilters.aggregation_group_type_index
    const { groups, groupProperties } = ctx
    let isInconclusive = false
    let result: FeatureFlagValue | undefined = undefined

    for (const condition of flagConditions) {
      try {
        const conditionAggregation =
          condition.aggregation_group_type_index !== undefined
            ? condition.aggregation_group_type_index
            : flagAggregation

        let effectiveProperties = properties
        let effectiveBucketingValue = bucketingValue

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

        if (await this.isConditionMatch(flag, effectiveBucketingValue, condition, effectiveProperties, ctx)) {
          const variantOverride = condition.variant
          const flagVariants = flagFilters.multivariate?.variants || []
          if (variantOverride && flagVariants.some((variant) => variant.key === variantOverride)) {
            result = variantOverride
          } else {
            result = (await this.getMatchingVariant(flag, effectiveBucketingValue)) || true
          }
          break
        }
      } catch (e) {
        if (e instanceof RequiresServerEvaluation) throw e
        if (e instanceof InconclusiveMatchError) {
          isInconclusive = true
        } else {
          throw e
        }
      }
    }

    if (result !== undefined) return result
    if (isInconclusive) {
      throw new InconclusiveMatchError("Can't determine if feature flag is enabled or not with given properties")
    }
    return false
  }

  private async isConditionMatch(
    flag: PostHogFeatureFlag,
    bucketingValue: string,
    condition: FeatureFlagCondition,
    properties: Record<string, any>,
    ctx: FeatureFlagEvaluationContext
  ): Promise<boolean> {
    const rolloutPercentage = condition.rollout_percentage
    const warn = (msg: string): void => this.logMsgIfDebug(() => console.warn(msg))

    if ((condition.properties || []).length > 0) {
      for (const prop of condition.properties) {
        let matches: boolean
        if (prop.type === 'cohort') {
          matches = matchCohort(prop, properties, this.cohorts, this.debugMode)
        } else if (prop.type === 'flag') {
          matches = await this.evaluateFlagDependency(prop, ctx)
        } else {
          matches = matchProperty(prop, properties, warn)
        }
        // `matchPropertyGroup` (cohort path) inverts on `negation`; the top-level flag condition
        // path needs to do the same or any negated property on a flag-level filter quietly passes.
        if (prop.negation) matches = !matches
        if (!matches) return false
      }
      if (rolloutPercentage == undefined) return true
    }

    if (rolloutPercentage != undefined && (await _hash(flag.key, bucketingValue)) > rolloutPercentage / 100.0) {
      return false
    }
    return true
  }

  private async getMatchingVariant(flag: PostHogFeatureFlag, bucketingValue: string): Promise<string | undefined> {
    const hashValue = await _hash(flag.key, bucketingValue, 'variant')
    return this.variantLookupTable(flag).find((v) => hashValue >= v.valueMin && hashValue < v.valueMax)?.key
  }

  private variantLookupTable(flag: PostHogFeatureFlag): { valueMin: number; valueMax: number; key: string }[] {
    const table: { valueMin: number; valueMax: number; key: string }[] = []
    let valueMin = 0
    const multivariates = flag.filters?.multivariate?.variants || []
    for (const variant of multivariates) {
      const valueMax = valueMin + variant.rollout_percentage / 100.0
      table.push({ valueMin, valueMax, key: variant.key })
      valueMin = valueMax
    }
    return table
  }
}

function flagEvaluatesToExpectedValue(expectedValue: FlagPropertyValue, flagValue: FeatureFlagValue): boolean {
  if (typeof expectedValue === 'boolean') {
    return expectedValue === flagValue || (typeof flagValue === 'string' && flagValue !== '' && expectedValue === true)
  }
  if (typeof expectedValue === 'string') return flagValue === expectedValue
  return false
}
