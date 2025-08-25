import { version } from '../package.json'

import {
  JsonType,
  PostHogCoreStateless,
  PostHogFlagsResponse,
  PostHogFetchOptions,
  PostHogFetchResponse,
  PostHogFlagsAndPayloadsResponse,
  PostHogPersistedProperty,
} from '@posthog/core'
import {
  EventMessage,
  GroupIdentifyMessage,
  IdentifyMessage,
  IPostHog,
  PostHogOptions,
  SendFeatureFlagsOptions,
  BeforeSendFn,
} from './types'
import { FeatureFlagDetail, FeatureFlagValue } from '@posthog/core'
import { FeatureFlagsPoller } from './extensions/feature-flags/feature-flags'
import ErrorTracking from './extensions/error-tracking'
import { isPlainObject } from './extensions/error-tracking/type-checking'
import { getFeatureFlagValue, safeSetTimeout } from '@posthog/core'
import { PostHogMemoryStorage } from './storage-memory'

// Standard local evaluation rate limit is 600 per minute (10 per second),
// so the fastest a poller should ever be set is 100ms.
const MINIMUM_POLLING_INTERVAL = 100
const THIRTY_SECONDS = 30 * 1000
const MAX_CACHE_SIZE = 50 * 1000

// The actual exported Nodejs API.
export abstract class PostHogBackendClient extends PostHogCoreStateless implements IPostHog {
  private _memoryStorage = new PostHogMemoryStorage()

  private featureFlagsPoller?: FeatureFlagsPoller
  protected errorTracking: ErrorTracking
  private maxCacheSize: number
  public readonly options: PostHogOptions

  distinctIdHasSentFlagCalls: Record<string, string[]>

  constructor(apiKey: string, options: PostHogOptions = {}) {
    super(apiKey, options)

    this.options = options

    this.options.featureFlagsPollingInterval =
      typeof options.featureFlagsPollingInterval === 'number'
        ? Math.max(options.featureFlagsPollingInterval, MINIMUM_POLLING_INTERVAL)
        : THIRTY_SECONDS

    if (options.personalApiKey) {
      if (options.personalApiKey.includes('phc_')) {
        throw new Error(
          'Your Personal API key is invalid. These keys are prefixed with "phx_" and can be created in PostHog project settings.'
        )
      }

      // Only start the poller if local evaluation is enabled (defaults to true for backward compatibility)
      const shouldEnableLocalEvaluation = options.enableLocalEvaluation !== false

      if (shouldEnableLocalEvaluation) {
        this.featureFlagsPoller = new FeatureFlagsPoller({
          pollingInterval: this.options.featureFlagsPollingInterval,
          personalApiKey: options.personalApiKey,
          projectApiKey: apiKey,
          timeout: options.requestTimeout ?? 10000, // 10 seconds
          host: this.host,
          fetch: options.fetch,
          onError: (err: Error) => {
            this._events.emit('error', err)
          },
          onLoad: (count: number) => {
            this._events.emit('localEvaluationFlagsLoaded', count)
          },
          customHeaders: this.getCustomHeaders(),
        })
      }
    }
    this.errorTracking = new ErrorTracking(this, options)
    this.distinctIdHasSentFlagCalls = {}
    this.maxCacheSize = options.maxCacheSize || MAX_CACHE_SIZE
  }

  getPersistedProperty(key: PostHogPersistedProperty): any | undefined {
    return this._memoryStorage.getProperty(key)
  }

  setPersistedProperty(key: PostHogPersistedProperty, value: any | null): void {
    return this._memoryStorage.setProperty(key, value)
  }

  fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
    return this.options.fetch ? this.options.fetch(url, options) : fetch(url, options)
  }
  getLibraryVersion(): string {
    return version
  }
  getCustomUserAgent(): string {
    return `${this.getLibraryId()}/${this.getLibraryVersion()}`
  }

  enable(): Promise<void> {
    return super.optIn()
  }

  disable(): Promise<void> {
    return super.optOut()
  }

  debug(enabled: boolean = true): void {
    super.debug(enabled)
    this.featureFlagsPoller?.debug(enabled)
  }
  
  /**
     * { @label Capture }
     * @description Capture an event manually.
     *
     * @example
     * ```ts
     * // Basic capture
     * client.capture({
     *   distinctId: 'user_123',
     *   event: 'button_clicked',
     *   properties: { button_color: 'red' }
     * })
     * ```
     *
     * @param props - The event properties
     * @returns void
     */
  capture(props: EventMessage): void {
    if (typeof props === 'string') {
      this.logMsgIfDebug(() =>
        console.warn('Called capture() with a string as the first argument when an object was expected.')
      )
    }
    const { distinctId, event, properties, groups, sendFeatureFlags, timestamp, disableGeoip, uuid }: EventMessage =
      props

    // Run before_send if configured
    const eventMessage = this._runBeforeSend({
      distinctId,
      event,
      properties,
      groups,
      sendFeatureFlags,
      timestamp,
      disableGeoip,
      uuid,
    })
    if (!eventMessage) {
      return
    }

    const _capture = (props: EventMessage['properties']): void => {
      super.captureStateless(eventMessage.distinctId, eventMessage.event, props, {
        timestamp: eventMessage.timestamp,
        disableGeoip: eventMessage.disableGeoip,
        uuid: eventMessage.uuid,
      })
    }

    // :TRICKY: If we flush, or need to shut down, to not lose events we want this promise to resolve before we flush
    const capturePromise = Promise.resolve()
      .then(async () => {
        if (sendFeatureFlags) {
          // If we are sending feature flags, we evaluate them locally if the user prefers it, otherwise we fall back to remote evaluation
          const sendFeatureFlagsOptions = typeof sendFeatureFlags === 'object' ? sendFeatureFlags : undefined
          return await this.getFeatureFlagsForEvent(distinctId, groups, disableGeoip, sendFeatureFlagsOptions)
        }

        if (event === '$feature_flag_called') {
          // If we're capturing a $feature_flag_called event, we don't want to enrich the event with cached flags that may be out of date.
          return {}
        }
        return {}
      })
      .then((flags) => {
        // Derive the relevant flag properties to add
        const additionalProperties: Record<string, any> = {}
        if (flags) {
          for (const [feature, variant] of Object.entries(flags)) {
            additionalProperties[`$feature/${feature}`] = variant
          }
        }
        const activeFlags = Object.keys(flags || {})
          .filter((flag) => flags?.[flag] !== false)
          .sort()
        if (activeFlags.length > 0) {
          additionalProperties['$active_feature_flags'] = activeFlags
        }

        return additionalProperties
      })
      .catch(() => {
        // Something went wrong getting the flag info - we should capture the event anyways
        return {}
      })
      .then((additionalProperties) => {
        // No matter what - capture the event
        _capture({
          ...additionalProperties,
          ...(eventMessage.properties || {}),
          $groups: eventMessage.groups || groups,
        })
      })

    this.addPendingPromise(capturePromise)
  }

  async captureImmediate(props: EventMessage): Promise<void> {
    if (typeof props === 'string') {
      this.logMsgIfDebug(() =>
        console.warn('Called capture() with a string as the first argument when an object was expected.')
      )
    }
    const { distinctId, event, properties, groups, sendFeatureFlags, timestamp, disableGeoip, uuid }: EventMessage =
      props

    // Run before_send if configured
    const eventMessage = this._runBeforeSend({
      distinctId,
      event,
      properties,
      groups,
      sendFeatureFlags,
      timestamp,
      disableGeoip,
      uuid,
    })
    if (!eventMessage) {
      return
    }

    const _capture = (props: EventMessage['properties']): Promise<void> => {
      return super.captureStatelessImmediate(eventMessage.distinctId, eventMessage.event, props, {
        timestamp: eventMessage.timestamp,
        disableGeoip: eventMessage.disableGeoip,
        uuid: eventMessage.uuid,
      })
    }

    const capturePromise = Promise.resolve()
      .then(async () => {
        if (sendFeatureFlags) {
          // If we are sending feature flags, we evaluate them locally if the user prefers it, otherwise we fall back to remote evaluation
          const sendFeatureFlagsOptions = typeof sendFeatureFlags === 'object' ? sendFeatureFlags : undefined
          return await this.getFeatureFlagsForEvent(distinctId, groups, disableGeoip, sendFeatureFlagsOptions)
        }

        if (event === '$feature_flag_called') {
          // If we're capturing a $feature_flag_called event, we don't want to enrich the event with cached flags that may be out of date.
          return {}
        }
        return {}
      })
      .then((flags) => {
        // Derive the relevant flag properties to add
        const additionalProperties: Record<string, any> = {}
        if (flags) {
          for (const [feature, variant] of Object.entries(flags)) {
            additionalProperties[`$feature/${feature}`] = variant
          }
        }
        const activeFlags = Object.keys(flags || {})
          .filter((flag) => flags?.[flag] !== false)
          .sort()
        if (activeFlags.length > 0) {
          additionalProperties['$active_feature_flags'] = activeFlags
        }

        return additionalProperties
      })
      .catch(() => {
        // Something went wrong getting the flag info - we should capture the event anyways
        return {}
      })
      .then((additionalProperties) => {
        // No matter what - capture the event
        _capture({
          ...additionalProperties,
          ...(eventMessage.properties || {}),
          $groups: eventMessage.groups || groups,
        })
      })

    await capturePromise
  }

  identify({ distinctId, properties, disableGeoip }: IdentifyMessage): void {
    // Catch properties passed as $set and move them to the top level

    // promote $set and $set_once to top level
    const userPropsOnce = properties?.$set_once
    delete properties?.$set_once

    // if no $set is provided we assume all properties are $set
    const userProps = properties?.$set || properties

    super.identifyStateless(
      distinctId,
      {
        $set: userProps,
        $set_once: userPropsOnce,
      },
      { disableGeoip }
    )
  }

  async identifyImmediate({ distinctId, properties, disableGeoip }: IdentifyMessage): Promise<void> {
    // promote $set and $set_once to top level
    const userPropsOnce = properties?.$set_once
    delete properties?.$set_once

    // if no $set is provided we assume all properties are $set
    const userProps = properties?.$set || properties

    await super.identifyStatelessImmediate(
      distinctId,
      {
        $set: userProps,
        $set_once: userPropsOnce,
      },
      { disableGeoip }
    )
  }

  alias(data: { distinctId: string; alias: string; disableGeoip?: boolean }): void {
    super.aliasStateless(data.alias, data.distinctId, undefined, { disableGeoip: data.disableGeoip })
  }

  async aliasImmediate(data: { distinctId: string; alias: string; disableGeoip?: boolean }): Promise<void> {
    await super.aliasStatelessImmediate(data.alias, data.distinctId, undefined, { disableGeoip: data.disableGeoip })
  }

  isLocalEvaluationReady(): boolean {
    return this.featureFlagsPoller?.isLocalEvaluationReady() ?? false
  }

  async waitForLocalEvaluationReady(timeoutMs: number = THIRTY_SECONDS): Promise<boolean> {
    if (this.isLocalEvaluationReady()) {
      return true
    }

    if (this.featureFlagsPoller === undefined) {
      return false
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup()
        resolve(false)
      }, timeoutMs)

      const cleanup = this._events.on('localEvaluationFlagsLoaded', (count: number) => {
        clearTimeout(timeout)
        cleanup()
        resolve(count > 0)
      })
    })
  }

  async getFeatureFlag(
    key: string,
    distinctId: string,
    options?: {
      groups?: Record<string, string>
      personProperties?: Record<string, string>
      groupProperties?: Record<string, Record<string, string>>
      onlyEvaluateLocally?: boolean
      sendFeatureFlagEvents?: boolean
      disableGeoip?: boolean
    }
  ): Promise<FeatureFlagValue | undefined> {
    const { groups, disableGeoip } = options || {}
    let { onlyEvaluateLocally, sendFeatureFlagEvents, personProperties, groupProperties } = options || {}

    const adjustedProperties = this.addLocalPersonAndGroupProperties(
      distinctId,
      groups,
      personProperties,
      groupProperties
    )

    personProperties = adjustedProperties.allPersonProperties
    groupProperties = adjustedProperties.allGroupProperties

    // set defaults
    if (onlyEvaluateLocally == undefined) {
      onlyEvaluateLocally = false
    }
    if (sendFeatureFlagEvents == undefined) {
      sendFeatureFlagEvents = true
    }

    let response = await this.featureFlagsPoller?.getFeatureFlag(
      key,
      distinctId,
      groups,
      personProperties,
      groupProperties
    )

    const flagWasLocallyEvaluated = response !== undefined
    let requestId = undefined
    let flagDetail: FeatureFlagDetail | undefined = undefined
    if (!flagWasLocallyEvaluated && !onlyEvaluateLocally) {
      const remoteResponse = await super.getFeatureFlagDetailStateless(
        key,
        distinctId,
        groups,
        personProperties,
        groupProperties,
        disableGeoip
      )

      if (remoteResponse === undefined) {
        return undefined
      }

      flagDetail = remoteResponse.response
      response = getFeatureFlagValue(flagDetail)
      requestId = remoteResponse?.requestId
    }

    const featureFlagReportedKey = `${key}_${response}`

    if (
      sendFeatureFlagEvents &&
      (!(distinctId in this.distinctIdHasSentFlagCalls) ||
        !this.distinctIdHasSentFlagCalls[distinctId].includes(featureFlagReportedKey))
    ) {
      if (Object.keys(this.distinctIdHasSentFlagCalls).length >= this.maxCacheSize) {
        this.distinctIdHasSentFlagCalls = {}
      }
      if (Array.isArray(this.distinctIdHasSentFlagCalls[distinctId])) {
        this.distinctIdHasSentFlagCalls[distinctId].push(featureFlagReportedKey)
      } else {
        this.distinctIdHasSentFlagCalls[distinctId] = [featureFlagReportedKey]
      }
      this.capture({
        distinctId,
        event: '$feature_flag_called',
        properties: {
          $feature_flag: key,
          $feature_flag_response: response,
          $feature_flag_id: flagDetail?.metadata?.id,
          $feature_flag_version: flagDetail?.metadata?.version,
          $feature_flag_reason: flagDetail?.reason?.description ?? flagDetail?.reason?.code,
          locally_evaluated: flagWasLocallyEvaluated,
          [`$feature/${key}`]: response,
          $feature_flag_request_id: requestId,
        },
        groups,
        disableGeoip,
      })
    }
    return response
  }

  async getFeatureFlagPayload(
    key: string,
    distinctId: string,
    matchValue?: FeatureFlagValue,
    options?: {
      groups?: Record<string, string>
      personProperties?: Record<string, string>
      groupProperties?: Record<string, Record<string, string>>
      onlyEvaluateLocally?: boolean
      sendFeatureFlagEvents?: boolean
      disableGeoip?: boolean
    }
  ): Promise<JsonType | undefined> {
    const { groups, disableGeoip } = options || {}
    let { onlyEvaluateLocally, sendFeatureFlagEvents, personProperties, groupProperties } = options || {}

    const adjustedProperties = this.addLocalPersonAndGroupProperties(
      distinctId,
      groups,
      personProperties,
      groupProperties
    )

    personProperties = adjustedProperties.allPersonProperties
    groupProperties = adjustedProperties.allGroupProperties

    let response = undefined

    const localEvaluationEnabled = this.featureFlagsPoller !== undefined
    if (localEvaluationEnabled) {
      // Ensure flags are loaded before checking for the specific flag
      await this.featureFlagsPoller?.loadFeatureFlags()

      const flag = this.featureFlagsPoller?.featureFlagsByKey[key]
      if (flag) {
        const result = await this.featureFlagsPoller?.computeFlagAndPayloadLocally(
          flag,
          distinctId,
          groups,
          personProperties,
          groupProperties,
          matchValue
        )
        if (result) {
          matchValue = result.value
          response = result.payload
        }
      }
    }

    // set defaults
    if (onlyEvaluateLocally == undefined) {
      onlyEvaluateLocally = false
    }
    if (sendFeatureFlagEvents == undefined) {
      sendFeatureFlagEvents = true
    }

    const payloadWasLocallyEvaluated = response !== undefined

    if (!payloadWasLocallyEvaluated && !onlyEvaluateLocally) {
      response = await super.getFeatureFlagPayloadStateless(
        key,
        distinctId,
        groups,
        personProperties,
        groupProperties,
        disableGeoip
      )
    }
    return response
  }

  async getRemoteConfigPayload(flagKey: string): Promise<JsonType | undefined> {
    if (!this.options.personalApiKey) {
      throw new Error('Personal API key is required for remote config payload decryption')
    }

    const response = await this._requestRemoteConfigPayload(flagKey)
    if (!response) {
      return undefined
    }

    const parsed = await response.json()
    // The payload from the endpoint is stored as a JSON encoded string. So when we return
    // it, it's effectively double encoded. As far as we know, we should never get single-encoded
    // JSON, but we'll be defensive here just in case.
    if (typeof parsed === 'string') {
      try {
        // If the parsed value is a string, try parsing it again to handle double-encoded JSON
        return JSON.parse(parsed)
      } catch (e) {
        // If second parse fails, return the string as is
        return parsed
      }
    }
    return parsed
  }

  async isFeatureEnabled(
    key: string,
    distinctId: string,
    options?: {
      groups?: Record<string, string>
      personProperties?: Record<string, string>
      groupProperties?: Record<string, Record<string, string>>
      onlyEvaluateLocally?: boolean
      sendFeatureFlagEvents?: boolean
      disableGeoip?: boolean
    }
  ): Promise<boolean | undefined> {
    const feat = await this.getFeatureFlag(key, distinctId, options)
    if (feat === undefined) {
      return undefined
    }
    return !!feat || false
  }

  async getAllFlags(
    distinctId: string,
    options?: {
      groups?: Record<string, string>
      personProperties?: Record<string, string>
      groupProperties?: Record<string, Record<string, string>>
      onlyEvaluateLocally?: boolean
      disableGeoip?: boolean
      flagKeys?: string[]
    }
  ): Promise<Record<string, FeatureFlagValue>> {
    const response = await this.getAllFlagsAndPayloads(distinctId, options)
    return response.featureFlags || {}
  }

  async getAllFlagsAndPayloads(
    distinctId: string,
    options?: {
      groups?: Record<string, string>
      personProperties?: Record<string, string>
      groupProperties?: Record<string, Record<string, string>>
      onlyEvaluateLocally?: boolean
      disableGeoip?: boolean
      flagKeys?: string[]
    }
  ): Promise<PostHogFlagsAndPayloadsResponse> {
    const { groups, disableGeoip, flagKeys } = options || {}
    let { onlyEvaluateLocally, personProperties, groupProperties } = options || {}

    const adjustedProperties = this.addLocalPersonAndGroupProperties(
      distinctId,
      groups,
      personProperties,
      groupProperties
    )

    personProperties = adjustedProperties.allPersonProperties
    groupProperties = adjustedProperties.allGroupProperties

    // set defaults
    if (onlyEvaluateLocally == undefined) {
      onlyEvaluateLocally = false
    }

    const localEvaluationResult = await this.featureFlagsPoller?.getAllFlagsAndPayloads(
      distinctId,
      groups,
      personProperties,
      groupProperties,
      flagKeys
    )

    let featureFlags = {}
    let featureFlagPayloads = {}
    let fallbackToFlags = true
    if (localEvaluationResult) {
      featureFlags = localEvaluationResult.response
      featureFlagPayloads = localEvaluationResult.payloads
      fallbackToFlags = localEvaluationResult.fallbackToFlags
    }

    if (fallbackToFlags && !onlyEvaluateLocally) {
      const remoteEvaluationResult = await super.getFeatureFlagsAndPayloadsStateless(
        distinctId,
        groups,
        personProperties,
        groupProperties,
        disableGeoip,
        flagKeys
      )
      featureFlags = {
        ...featureFlags,
        ...(remoteEvaluationResult.flags || {}),
      }
      featureFlagPayloads = {
        ...featureFlagPayloads,
        ...(remoteEvaluationResult.payloads || {}),
      }
    }

    return { featureFlags, featureFlagPayloads }
  }

  groupIdentify({ groupType, groupKey, properties, distinctId, disableGeoip }: GroupIdentifyMessage): void {
    super.groupIdentifyStateless(groupType, groupKey, properties, { disableGeoip }, distinctId)
  }

  /**
   * Reloads the feature flag definitions from the server for local evaluation.
   * This is useful to call if you want to ensure that the feature flags are up to date before calling getFeatureFlag.
   */
  async reloadFeatureFlags(): Promise<void> {
    await this.featureFlagsPoller?.loadFeatureFlags(true)
  }

  async _shutdown(shutdownTimeoutMs?: number): Promise<void> {
    this.featureFlagsPoller?.stopPoller()
    return super._shutdown(shutdownTimeoutMs)
  }

  private async _requestRemoteConfigPayload(flagKey: string): Promise<PostHogFetchResponse | undefined> {
    if (!this.options.personalApiKey) {
      return undefined
    }

    const url = `${this.host}/api/projects/@current/feature_flags/${flagKey}/remote_config?token=${encodeURIComponent(this.apiKey)}`

    const options: PostHogFetchOptions = {
      method: 'GET',
      headers: {
        ...this.getCustomHeaders(),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.personalApiKey}`,
      },
    }

    let abortTimeout = null
    if (this.options.requestTimeout && typeof this.options.requestTimeout === 'number') {
      const controller = new AbortController()
      abortTimeout = safeSetTimeout(() => {
        controller.abort()
      }, this.options.requestTimeout)
      options.signal = controller.signal
    }

    try {
      return await this.fetch(url, options)
    } catch (error) {
      this._events.emit('error', error)
      return undefined
    } finally {
      if (abortTimeout) {
        clearTimeout(abortTimeout)
      }
    }
  }

  private extractPropertiesFromEvent(
    eventProperties?: Record<string | number, any>,
    groups?: Record<string, string | number>
  ): {
    personProperties: Record<string, string>
    groupProperties: Record<string, Record<string, string>>
  } {
    if (!eventProperties) {
      return { personProperties: {}, groupProperties: {} }
    }

    const personProperties: Record<string, string> = {}
    const groupProperties: Record<string, Record<string, string>> = {}

    for (const [key, value] of Object.entries(eventProperties)) {
      // If the value is a plain object and the key exists in groups, treat it as group properties
      if (isPlainObject(value) && groups && key in groups) {
        const groupProps: Record<string, string> = {}
        for (const [groupKey, groupValue] of Object.entries(value as Record<string, any>)) {
          groupProps[String(groupKey)] = String(groupValue)
        }
        groupProperties[String(key)] = groupProps
      } else {
        // Otherwise treat as person property
        personProperties[String(key)] = String(value)
      }
    }

    return { personProperties, groupProperties }
  }

  private async getFeatureFlagsForEvent(
    distinctId: string,
    groups?: Record<string, string | number>,
    disableGeoip?: boolean,
    sendFeatureFlagsOptions?: SendFeatureFlagsOptions
  ): Promise<PostHogFlagsResponse['featureFlags'] | undefined> {
    // Use properties directly from options if they exist
    const finalPersonProperties = sendFeatureFlagsOptions?.personProperties || {}
    const finalGroupProperties = sendFeatureFlagsOptions?.groupProperties || {}
    const flagKeys = sendFeatureFlagsOptions?.flagKeys

    // Check if we should only evaluate locally
    const onlyEvaluateLocally = sendFeatureFlagsOptions?.onlyEvaluateLocally ?? false

    // If onlyEvaluateLocally is true, only use local evaluation
    if (onlyEvaluateLocally) {
      if ((this.featureFlagsPoller?.featureFlags?.length || 0) > 0) {
        const groupsWithStringValues: Record<string, string> = {}
        for (const [key, value] of Object.entries(groups || {})) {
          groupsWithStringValues[key] = String(value)
        }

        return await this.getAllFlags(distinctId, {
          groups: groupsWithStringValues,
          personProperties: finalPersonProperties,
          groupProperties: finalGroupProperties,
          disableGeoip,
          onlyEvaluateLocally: true,
          flagKeys,
        })
      } else {
        // If onlyEvaluateLocally is true but we don't have local flags, return empty
        return {}
      }
    }

    // Prefer local evaluation if available (default behavior; I'd rather not penalize users who haven't updated to the new API but still want to use local evaluation)
    if ((this.featureFlagsPoller?.featureFlags?.length || 0) > 0) {
      const groupsWithStringValues: Record<string, string> = {}
      for (const [key, value] of Object.entries(groups || {})) {
        groupsWithStringValues[key] = String(value)
      }

      return await this.getAllFlags(distinctId, {
        groups: groupsWithStringValues,
        personProperties: finalPersonProperties,
        groupProperties: finalGroupProperties,
        disableGeoip,
        onlyEvaluateLocally: true,
        flagKeys,
      })
    }

    // Fall back to remote evaluation if local evaluation is not available
    return (
      await super.getFeatureFlagsStateless(
        distinctId,
        groups,
        finalPersonProperties,
        finalGroupProperties,
        disableGeoip
      )
    ).flags
  }

  private addLocalPersonAndGroupProperties(
    distinctId: string,
    groups?: Record<string, string>,
    personProperties?: Record<string, string>,
    groupProperties?: Record<string, Record<string, string>>
  ): { allPersonProperties: Record<string, string>; allGroupProperties: Record<string, Record<string, string>> } {
    const allPersonProperties = { distinct_id: distinctId, ...(personProperties || {}) }

    const allGroupProperties: Record<string, Record<string, string>> = {}
    if (groups) {
      for (const groupName of Object.keys(groups)) {
        allGroupProperties[groupName] = {
          $group_key: groups[groupName],
          ...(groupProperties?.[groupName] || {}),
        }
      }
    }

    return { allPersonProperties, allGroupProperties }
  }

  captureException(error: unknown, distinctId?: string, additionalProperties?: Record<string | number, any>): void {
    const syntheticException = new Error('PostHog syntheticException')
    ErrorTracking.buildEventMessage(error, { syntheticException }, distinctId, additionalProperties).then((msg) => {
      this.capture(msg)
    })
  }

  async captureExceptionImmediate(
    error: unknown,
    distinctId?: string,
    additionalProperties?: Record<string | number, any>
  ): Promise<void> {
    const syntheticException = new Error('PostHog syntheticException')
    const evtMsg = await ErrorTracking.buildEventMessage(
      error,
      { syntheticException },
      distinctId,
      additionalProperties
    )
    return await this.captureImmediate(evtMsg)
  }

  private _runBeforeSend(eventMessage: EventMessage): EventMessage | null {
    const beforeSend = this.options.before_send
    if (!beforeSend) {
      return eventMessage
    }

    const fns = Array.isArray(beforeSend) ? beforeSend : [beforeSend]
    let result: EventMessage | null = eventMessage

    for (const fn of fns) {
      result = fn(result)
      if (!result) {
        this.logMsgIfDebug(() => console.info(`Event '${eventMessage.event}' was rejected in beforeSend function`))
        return null
      }
      if (!result.properties || Object.keys(result.properties).length === 0) {
        const message = `Event '${result.event}' has no properties after beforeSend function, this is likely an error.`
        this.logMsgIfDebug(() => console.warn(message))
      }
    }

    return result
  }
}
