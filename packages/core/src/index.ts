import {
  PostHogFetchOptions,
  PostHogFetchResponse,
  PostHogQueueItem,
  PostHogAutocaptureElement,
  PostHogFlagsResponse,
  PostHogCoreOptions,
  PostHogEventProperties,
  PostHogPersistedProperty,
  PostHogCaptureOptions,
  JsonType,
  PostHogRemoteConfig,
  FeatureFlagValue,
  PostHogV2FlagsResponse,
  PostHogV1FlagsResponse,
  PostHogFeatureFlagDetails,
  PostHogFlagsStorageFormat,
  FeatureFlagDetail,
  Survey,
  SurveyResponse,
  PostHogGroupProperties,
  Compression,
} from './types'
import {
  createFlagsResponseFromFlagsAndPayloads,
  getFeatureFlagValue,
  getFlagValuesFromFlags,
  getPayloadsFromFlags,
  normalizeFlagsResponse,
  updateFlagValue,
} from './featureFlagUtils'
import {
  allSettled,
  assert,
  currentISOTime,
  isError,
  removeTrailingSlash,
  retriable,
  RetriableOptions,
  safeSetTimeout,
  STRING_FORMAT,
} from './utils'
import { isGzipSupported, gzipCompress } from './gzip'
import { SimpleEventEmitter } from './eventemitter'
import { uuidv7 } from './vendor/uuidv7'

export { safeSetTimeout } from './utils'
export { getFetch } from './utils'
export { getFeatureFlagValue } from './featureFlagUtils'
export * as utils from './utils'

class PostHogFetchHttpError extends Error {
  name = 'PostHogFetchHttpError'

  constructor(public response: PostHogFetchResponse, public reqByteLength: number) {
    super('HTTP error while fetching PostHog: status=' + response.status + ', reqByteLength=' + reqByteLength)
  }

  get status(): number {
    return this.response.status
  }

  get text(): Promise<string> {
    return this.response.text()
  }

  get json(): Promise<any> {
    return this.response.json()
  }
}

class PostHogFetchNetworkError extends Error {
  name = 'PostHogFetchNetworkError'

  constructor(public error: unknown) {
    // TRICKY: "cause" is a newer property but is just ignored otherwise. Cast to any to ignore the type issue.
    // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
    // @ts-ignore
    super('Network error while fetching PostHog', error instanceof Error ? { cause: error } : {})
  }
}

export const maybeAdd = (key: string, value: JsonType | undefined): Record<string, JsonType> =>
  value !== undefined ? { [key]: value } : {}

export async function logFlushError(err: any): Promise<void> {
  if (err instanceof PostHogFetchHttpError) {
    let text = ''
    try {
      text = await err.text
    } catch {}

    console.error(`Error while flushing PostHog: message=${err.message}, response body=${text}`, err)
  } else {
    console.error('Error while flushing PostHog', err)
  }
  return Promise.resolve()
}

function isPostHogFetchError(err: unknown): err is PostHogFetchHttpError | PostHogFetchNetworkError {
  return typeof err === 'object' && (err instanceof PostHogFetchHttpError || err instanceof PostHogFetchNetworkError)
}

function isPostHogFetchContentTooLargeError(err: unknown): err is PostHogFetchHttpError & { status: 413 } {
  return typeof err === 'object' && err instanceof PostHogFetchHttpError && err.status === 413
}

enum QuotaLimitedFeature {
  FeatureFlags = 'feature_flags',
  Recordings = 'recordings',
}

export abstract class PostHogCoreStateless {
  // options
  readonly apiKey: string
  readonly host: string
  readonly flushAt: number
  readonly preloadFeatureFlags: boolean
  readonly disableSurveys: boolean
  private maxBatchSize: number
  private maxQueueSize: number
  private flushInterval: number
  private flushPromise: Promise<any> | null = null
  private shutdownPromise: Promise<void> | null = null
  private requestTimeout: number
  private featureFlagsRequestTimeoutMs: number
  private remoteConfigRequestTimeoutMs: number
  private removeDebugCallback?: () => void
  private disableGeoip: boolean
  private historicalMigration: boolean
  protected disabled
  protected disableCompression: boolean

  private defaultOptIn: boolean
  private pendingPromises: Record<string, Promise<any>> = {}

  // internal
  protected _events = new SimpleEventEmitter()
  protected _flushTimer?: any
  protected _retryOptions: RetriableOptions
  protected _initPromise: Promise<void>
  protected _isInitialized: boolean = false
  protected _remoteConfigResponsePromise?: Promise<PostHogRemoteConfig | undefined>

  // Abstract methods to be overridden by implementations
  abstract fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse>
  abstract getLibraryId(): string
  abstract getLibraryVersion(): string
  abstract getCustomUserAgent(): string | void

  // This is our abstracted storage. Each implementation should handle its own
  abstract getPersistedProperty<T>(key: PostHogPersistedProperty): T | undefined
  abstract setPersistedProperty<T>(key: PostHogPersistedProperty, value: T | null): void

  constructor(apiKey: string, options?: PostHogCoreOptions) {
    assert(apiKey, "You must pass your PostHog project's api key.")

    this.apiKey = apiKey
    this.host = removeTrailingSlash(options?.host || 'https://us.i.posthog.com')
    this.flushAt = options?.flushAt ? Math.max(options?.flushAt, 1) : 20
    this.maxBatchSize = Math.max(this.flushAt, options?.maxBatchSize ?? 100)
    this.maxQueueSize = Math.max(this.flushAt, options?.maxQueueSize ?? 1000)
    this.flushInterval = options?.flushInterval ?? 10000
    this.preloadFeatureFlags = options?.preloadFeatureFlags ?? true
    // If enable is explicitly set to false we override the optout
    this.defaultOptIn = options?.defaultOptIn ?? true
    this.disableSurveys = options?.disableSurveys ?? false

    this._retryOptions = {
      retryCount: options?.fetchRetryCount ?? 3,
      retryDelay: options?.fetchRetryDelay ?? 3000, // 3 seconds
      retryCheck: isPostHogFetchError,
    }
    this.requestTimeout = options?.requestTimeout ?? 10000 // 10 seconds
    this.featureFlagsRequestTimeoutMs = options?.featureFlagsRequestTimeoutMs ?? 3000 // 3 seconds
    this.remoteConfigRequestTimeoutMs = options?.remoteConfigRequestTimeoutMs ?? 3000 // 3 seconds
    this.disableGeoip = options?.disableGeoip ?? true
    this.disabled = options?.disabled ?? false
    this.historicalMigration = options?.historicalMigration ?? false
    // Init promise allows the derived class to block calls until it is ready
    this._initPromise = Promise.resolve()
    this._isInitialized = true
    this.disableCompression = !isGzipSupported() || (options?.disableCompression ?? false)
  }

  protected logMsgIfDebug(fn: () => void): void {
    if (this.isDebug) {
      fn()
    }
  }

  protected wrap(fn: () => void): void {
    if (this.disabled) {
      this.logMsgIfDebug(() => console.warn('[PostHog] The client is disabled'))
      return
    }

    if (this._isInitialized) {
      // NOTE: We could also check for the "opt in" status here...
      return fn()
    }

    this._initPromise.then(() => fn())
  }

  protected getCommonEventProperties(): PostHogEventProperties {
    return {
      $lib: this.getLibraryId(),
      $lib_version: this.getLibraryVersion(),
    }
  }

  public get optedOut(): boolean {
    return this.getPersistedProperty(PostHogPersistedProperty.OptedOut) ?? !this.defaultOptIn
  }

  async optIn(): Promise<void> {
    this.wrap(() => {
      this.setPersistedProperty(PostHogPersistedProperty.OptedOut, false)
    })
  }

  async optOut(): Promise<void> {
    this.wrap(() => {
      this.setPersistedProperty(PostHogPersistedProperty.OptedOut, true)
    })
  }

  on(event: string, cb: (...args: any[]) => void): () => void {
    return this._events.on(event, cb)
  }

  debug(enabled: boolean = true): void {
    this.removeDebugCallback?.()

    if (enabled) {
      const removeDebugCallback = this.on('*', (event, payload) => console.log('PostHog Debug', event, payload))
      this.removeDebugCallback = () => {
        removeDebugCallback()
        this.removeDebugCallback = undefined
      }
    }
  }

  get isDebug(): boolean {
    return !!this.removeDebugCallback
  }

  get isDisabled(): boolean {
    return this.disabled
  }

  private buildPayload(payload: {
    distinct_id: string
    event: string
    properties?: PostHogEventProperties
  }): PostHogEventProperties {
    return {
      distinct_id: payload.distinct_id,
      event: payload.event,
      properties: {
        ...(payload.properties || {}),
        ...this.getCommonEventProperties(), // Common PH props
      },
    }
  }

  protected addPendingPromise<T>(promise: Promise<T>): Promise<T> {
    const promiseUUID = uuidv7()
    this.pendingPromises[promiseUUID] = promise
    promise
      .catch(() => {})
      .finally(() => {
        delete this.pendingPromises[promiseUUID]
      })

    return promise
  }

  /***
   *** TRACKING
   ***/
  protected identifyStateless(
    distinctId: string,
    properties?: PostHogEventProperties,
    options?: PostHogCaptureOptions
  ): void {
    this.wrap(() => {
      // The properties passed to identifyStateless are event properties.
      // To add person properties, pass in all person properties to the `$set` and `$set_once` keys.

      const payload = {
        ...this.buildPayload({
          distinct_id: distinctId,
          event: '$identify',
          properties,
        }),
      }

      this.enqueue('identify', payload, options)
    })
  }

  protected async identifyStatelessImmediate(
    distinctId: string,
    properties?: PostHogEventProperties,
    options?: PostHogCaptureOptions
  ): Promise<void> {
    const payload = {
      ...this.buildPayload({
        distinct_id: distinctId,
        event: '$identify',
        properties,
      }),
    }

    await this.sendImmediate('identify', payload, options)
  }

  protected captureStateless(
    distinctId: string,
    event: string,
    properties?: PostHogEventProperties,
    options?: PostHogCaptureOptions
  ): void {
    this.wrap(() => {
      const payload = this.buildPayload({ distinct_id: distinctId, event, properties })
      this.enqueue('capture', payload, options)
    })
  }

  protected async captureStatelessImmediate(
    distinctId: string,
    event: string,
    properties?: PostHogEventProperties,
    options?: PostHogCaptureOptions
  ): Promise<void> {
    const payload = this.buildPayload({ distinct_id: distinctId, event, properties })
    await this.sendImmediate('capture', payload, options)
  }

  protected aliasStateless(
    alias: string,
    distinctId: string,
    properties?: PostHogEventProperties,
    options?: PostHogCaptureOptions
  ): void {
    this.wrap(() => {
      const payload = this.buildPayload({
        event: '$create_alias',
        distinct_id: distinctId,
        properties: {
          ...(properties || {}),
          distinct_id: distinctId,
          alias,
        },
      })

      this.enqueue('alias', payload, options)
    })
  }

  protected async aliasStatelessImmediate(
    alias: string,
    distinctId: string,
    properties?: PostHogEventProperties,
    options?: PostHogCaptureOptions
  ): Promise<void> {
    const payload = this.buildPayload({
      event: '$create_alias',
      distinct_id: distinctId,
      properties: {
        ...(properties || {}),
        distinct_id: distinctId,
        alias,
      },
    })

    await this.sendImmediate('alias', payload, options)
  }

  /***
   *** GROUPS
   ***/
  protected groupIdentifyStateless(
    groupType: string,
    groupKey: string | number,
    groupProperties?: PostHogEventProperties,
    options?: PostHogCaptureOptions,
    distinctId?: string,
    eventProperties?: PostHogEventProperties
  ): void {
    this.wrap(() => {
      const payload = this.buildPayload({
        distinct_id: distinctId || `$${groupType}_${groupKey}`,
        event: '$groupidentify',
        properties: {
          $group_type: groupType,
          $group_key: groupKey,
          $group_set: groupProperties || {},
          ...(eventProperties || {}),
        },
      })

      this.enqueue('capture', payload, options)
    })
  }

  protected async getRemoteConfig(): Promise<PostHogRemoteConfig | undefined> {
    await this._initPromise

    let host = this.host

    if (host === 'https://us.i.posthog.com') {
      host = 'https://us-assets.i.posthog.com'
    } else if (host === 'https://eu.i.posthog.com') {
      host = 'https://eu-assets.i.posthog.com'
    }

    const url = `${host}/array/${this.apiKey}/config`
    const fetchOptions: PostHogFetchOptions = {
      method: 'GET',
      headers: { ...this.getCustomHeaders(), 'Content-Type': 'application/json' },
    }
    // Don't retry remote config API calls
    return this.fetchWithRetry(url, fetchOptions, { retryCount: 0 }, this.remoteConfigRequestTimeoutMs)
      .then((response) => response.json() as Promise<PostHogRemoteConfig>)
      .catch((error) => {
        this.logMsgIfDebug(() => console.error('Remote config could not be loaded', error))
        this._events.emit('error', error)
        return undefined
      })
  }

  /***
   *** FEATURE FLAGS
   ***/

  protected async getFlags(
    distinctId: string,
    groups: Record<string, string | number> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    extraPayload: Record<string, any> = {}
  ): Promise<PostHogFlagsResponse | undefined> {
    await this._initPromise

    const url = `${this.host}/flags/?v=2&config=true`
    const fetchOptions: PostHogFetchOptions = {
      method: 'POST',
      headers: { ...this.getCustomHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: this.apiKey,
        distinct_id: distinctId,
        groups,
        person_properties: personProperties,
        group_properties: groupProperties,
        ...extraPayload,
      }),
    }

    this.logMsgIfDebug(() => console.log('PostHog Debug', 'Flags URL', url))

    // Don't retry /flags API calls
    return this.fetchWithRetry(url, fetchOptions, { retryCount: 0 }, this.featureFlagsRequestTimeoutMs)
      .then((response) => response.json() as Promise<PostHogV1FlagsResponse | PostHogV2FlagsResponse>)
      .then((response) => normalizeFlagsResponse(response))
      .catch((error) => {
        this._events.emit('error', error)
        return undefined
      }) as Promise<PostHogFlagsResponse | undefined>
  }

  protected async getFeatureFlagStateless(
    key: string,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    disableGeoip?: boolean
  ): Promise<{
    response: FeatureFlagValue | undefined
    requestId: string | undefined
  }> {
    await this._initPromise

    const flagDetailResponse = await this.getFeatureFlagDetailStateless(
      key,
      distinctId,
      groups,
      personProperties,
      groupProperties,
      disableGeoip
    )

    if (flagDetailResponse === undefined) {
      // If we haven't loaded flags yet, or errored out, we respond with undefined
      return {
        response: undefined,
        requestId: undefined,
      }
    }

    let response = getFeatureFlagValue(flagDetailResponse.response)

    if (response === undefined) {
      // For cases where the flag is unknown, return false
      response = false
    }

    // If we have flags we either return the value (true or string) or false
    return {
      response,
      requestId: flagDetailResponse.requestId,
    }
  }

  protected async getFeatureFlagDetailStateless(
    key: string,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    disableGeoip?: boolean
  ): Promise<
    | {
        response: FeatureFlagDetail | undefined
        requestId: string | undefined
      }
    | undefined
  > {
    await this._initPromise

    const flagsResponse = await this.getFeatureFlagDetailsStateless(
      distinctId,
      groups,
      personProperties,
      groupProperties,
      disableGeoip,
      [key]
    )

    if (flagsResponse === undefined) {
      return undefined
    }

    const featureFlags = flagsResponse.flags

    const flagDetail = featureFlags[key]

    return {
      response: flagDetail,
      requestId: flagsResponse.requestId,
    }
  }

  protected async getFeatureFlagPayloadStateless(
    key: string,
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    disableGeoip?: boolean
  ): Promise<JsonType | undefined> {
    await this._initPromise

    const payloads = await this.getFeatureFlagPayloadsStateless(
      distinctId,
      groups,
      personProperties,
      groupProperties,
      disableGeoip,
      [key]
    )

    if (!payloads) {
      return undefined
    }

    const response = payloads[key]

    // Undefined means a loading or missing data issue. Null means evaluation happened and there was no match
    if (response === undefined) {
      return null
    }

    return response
  }

  protected async getFeatureFlagPayloadsStateless(
    distinctId: string,
    groups: Record<string, string> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    disableGeoip?: boolean,
    flagKeysToEvaluate?: string[]
  ): Promise<PostHogFlagsResponse['featureFlagPayloads'] | undefined> {
    await this._initPromise

    const payloads = (
      await this.getFeatureFlagsAndPayloadsStateless(
        distinctId,
        groups,
        personProperties,
        groupProperties,
        disableGeoip,
        flagKeysToEvaluate
      )
    ).payloads

    return payloads
  }

  protected async getFeatureFlagsStateless(
    distinctId: string,
    groups: Record<string, string | number> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    disableGeoip?: boolean,
    flagKeysToEvaluate?: string[]
  ): Promise<{
    flags: PostHogFlagsResponse['featureFlags'] | undefined
    payloads: PostHogFlagsResponse['featureFlagPayloads'] | undefined
    requestId: PostHogFlagsResponse['requestId'] | undefined
  }> {
    await this._initPromise

    return await this.getFeatureFlagsAndPayloadsStateless(
      distinctId,
      groups,
      personProperties,
      groupProperties,
      disableGeoip,
      flagKeysToEvaluate
    )
  }

  protected async getFeatureFlagsAndPayloadsStateless(
    distinctId: string,
    groups: Record<string, string | number> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    disableGeoip?: boolean,
    flagKeysToEvaluate?: string[]
  ): Promise<{
    flags: PostHogFlagsResponse['featureFlags'] | undefined
    payloads: PostHogFlagsResponse['featureFlagPayloads'] | undefined
    requestId: PostHogFlagsResponse['requestId'] | undefined
  }> {
    await this._initPromise

    const featureFlagDetails = await this.getFeatureFlagDetailsStateless(
      distinctId,
      groups,
      personProperties,
      groupProperties,
      disableGeoip,
      flagKeysToEvaluate
    )

    if (!featureFlagDetails) {
      return {
        flags: undefined,
        payloads: undefined,
        requestId: undefined,
      }
    }

    return {
      flags: featureFlagDetails.featureFlags,
      payloads: featureFlagDetails.featureFlagPayloads,
      requestId: featureFlagDetails.requestId,
    }
  }

  protected async getFeatureFlagDetailsStateless(
    distinctId: string,
    groups: Record<string, string | number> = {},
    personProperties: Record<string, string> = {},
    groupProperties: Record<string, Record<string, string>> = {},
    disableGeoip?: boolean,
    flagKeysToEvaluate?: string[]
  ): Promise<PostHogFeatureFlagDetails | undefined> {
    await this._initPromise

    const extraPayload: Record<string, any> = {}
    if (disableGeoip ?? this.disableGeoip) {
      extraPayload['geoip_disable'] = true
    }
    if (flagKeysToEvaluate) {
      extraPayload['flag_keys_to_evaluate'] = flagKeysToEvaluate
    }
    const flagsResponse = await this.getFlags(distinctId, groups, personProperties, groupProperties, extraPayload)

    if (flagsResponse === undefined) {
      // We probably errored out, so return undefined
      return undefined
    }

    // if there's an error on the flagsResponse, log a console error, but don't throw an error
    if (flagsResponse.errorsWhileComputingFlags) {
      console.error(
        '[FEATURE FLAGS] Error while computing feature flags, some flags may be missing or incorrect. Learn more at https://posthog.com/docs/feature-flags/best-practices'
      )
    }

    // Add check for quota limitation on feature flags
    if (flagsResponse.quotaLimited?.includes(QuotaLimitedFeature.FeatureFlags)) {
      console.warn(
        '[FEATURE FLAGS] Feature flags quota limit exceeded - feature flags unavailable. Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts'
      )
      return {
        flags: {},
        featureFlags: {},
        featureFlagPayloads: {},
        requestId: flagsResponse?.requestId,
      }
    }

    return flagsResponse
  }

  /***
   *** SURVEYS
   ***/

  public async getSurveysStateless(): Promise<SurveyResponse['surveys']> {
    await this._initPromise

    if (this.disableSurveys === true) {
      this.logMsgIfDebug(() => console.log('PostHog Debug', 'Loading surveys is disabled.'))
      return []
    }

    const url = `${this.host}/api/surveys/?token=${this.apiKey}`
    const fetchOptions: PostHogFetchOptions = {
      method: 'GET',
      headers: { ...this.getCustomHeaders(), 'Content-Type': 'application/json' },
    }

    const response = await this.fetchWithRetry(url, fetchOptions)
      .then((response) => {
        if (response.status !== 200 || !response.json) {
          const msg = `Surveys API could not be loaded: ${response.status}`
          const error = new Error(msg)
          this.logMsgIfDebug(() => console.error(error))

          this._events.emit('error', new Error(msg))
          return undefined
        }

        return response.json() as Promise<SurveyResponse>
      })
      .catch((error) => {
        this.logMsgIfDebug(() => console.error('Surveys API could not be loaded', error))

        this._events.emit('error', error)
        return undefined
      })

    const newSurveys = response?.surveys

    if (newSurveys) {
      this.logMsgIfDebug(() => console.log('PostHog Debug', 'Surveys fetched from API: ', JSON.stringify(newSurveys)))
    }

    return newSurveys ?? []
  }

  /***
   *** SUPER PROPERTIES
   ***/
  private _props: PostHogEventProperties | undefined

  protected get props(): PostHogEventProperties {
    if (!this._props) {
      this._props = this.getPersistedProperty<PostHogEventProperties>(PostHogPersistedProperty.Props)
    }
    return this._props || {}
  }

  protected set props(val: PostHogEventProperties | undefined) {
    this._props = val
  }

  async register(properties: PostHogEventProperties): Promise<void> {
    this.wrap(() => {
      this.props = {
        ...this.props,
        ...properties,
      }
      this.setPersistedProperty<PostHogEventProperties>(PostHogPersistedProperty.Props, this.props)
    })
  }

  async unregister(property: string): Promise<void> {
    this.wrap(() => {
      delete this.props[property]
      this.setPersistedProperty<PostHogEventProperties>(PostHogPersistedProperty.Props, this.props)
    })
  }

  /***
   *** QUEUEING AND FLUSHING
   ***/
  protected enqueue(type: string, _message: any, options?: PostHogCaptureOptions): void {
    this.wrap(() => {
      if (this.optedOut) {
        this._events.emit(type, `Library is disabled. Not sending event. To re-enable, call posthog.optIn()`)
        return
      }

      const message = this.prepareMessage(type, _message, options)

      const queue = this.getPersistedProperty<PostHogQueueItem[]>(PostHogPersistedProperty.Queue) || []

      if (queue.length >= this.maxQueueSize) {
        queue.shift()
        this.logMsgIfDebug(() => console.info('Queue is full, the oldest event is dropped.'))
      }

      queue.push({ message })
      this.setPersistedProperty<PostHogQueueItem[]>(PostHogPersistedProperty.Queue, queue)

      this._events.emit(type, message)

      // Flush queued events if we meet the flushAt length
      if (queue.length >= this.flushAt) {
        this.flushBackground()
      }

      if (this.flushInterval && !this._flushTimer) {
        this._flushTimer = safeSetTimeout(() => this.flushBackground(), this.flushInterval)
      }
    })
  }

  protected async sendImmediate(type: string, _message: any, options?: PostHogCaptureOptions): Promise<void> {
    if (this.disabled) {
      this.logMsgIfDebug(() => console.warn('[PostHog] The client is disabled'))
      return
    }

    if (!this._isInitialized) {
      await this._initPromise
    }

    if (this.optedOut) {
      this._events.emit(type, `Library is disabled. Not sending event. To re-enable, call posthog.optIn()`)
      return
    }

    const data: Record<string, any> = {
      api_key: this.apiKey,
      batch: [this.prepareMessage(type, _message, options)],
      sent_at: currentISOTime(),
    }

    if (this.historicalMigration) {
      data.historical_migration = true
    }

    const payload = JSON.stringify(data)

    const url = `${this.host}/batch/`

    const gzippedPayload = !this.disableCompression ? await gzipCompress(payload, this.isDebug) : null
    const fetchOptions: PostHogFetchOptions = {
      method: 'POST',
      headers: {
        ...this.getCustomHeaders(),
        'Content-Type': 'application/json',
        ...(gzippedPayload !== null && { 'Content-Encoding': 'gzip' }),
      },
      body: gzippedPayload || payload,
    }

    try {
      await this.fetchWithRetry(url, fetchOptions)
    } catch (err) {
      this._events.emit('error', err)
    }
  }

  private prepareMessage(type: string, _message: any, options?: PostHogCaptureOptions): PostHogEventProperties {
    const message = {
      ..._message,
      type: type,
      library: this.getLibraryId(),
      library_version: this.getLibraryVersion(),
      timestamp: options?.timestamp ? options?.timestamp : currentISOTime(),
      uuid: options?.uuid ? options.uuid : uuidv7(),
    }

    const addGeoipDisableProperty = options?.disableGeoip ?? this.disableGeoip
    if (addGeoipDisableProperty) {
      if (!message.properties) {
        message.properties = {}
      }
      message['properties']['$geoip_disable'] = true
    }

    if (message.distinctId) {
      message.distinct_id = message.distinctId
      delete message.distinctId
    }

    return message
  }

  private clearFlushTimer(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer)
      this._flushTimer = undefined
    }
  }

  /**
   * Helper for flushing the queue in the background
   * Avoids unnecessary promise errors
   */
  private flushBackground(): void {
    void this.flush().catch(async (err) => {
      await logFlushError(err)
    })
  }

  /**
   * Flushes the queue
   *
   * This function will return a promise that will resolve when the flush is complete,
   * or reject if there was an error (for example if the server or network is down).
   *
   * If there is already a flush in progress, this function will wait for that flush to complete.
   *
   * It's recommended to do error handling in the callback of the promise.
   *
   * @example
   * posthog.flush().then(() => {
   *   console.log('Flush complete')
   * }).catch((err) => {
   *   console.error('Flush failed', err)
   * })
   *
   *
   * @throws PostHogFetchHttpError
   * @throws PostHogFetchNetworkError
   * @throws Error
   */
  async flush(): Promise<void> {
    // Wait for the current flush operation to finish (regardless of success or failure), then try to flush again.
    // Use allSettled instead of finally to be defensive around flush throwing errors immediately rather than rejecting.
    // Use a custom allSettled implementation to avoid issues with patching Promise on RN
    const nextFlushPromise = allSettled([this.flushPromise]).then(() => {
      return this._flush()
    })

    this.flushPromise = nextFlushPromise
    void this.addPendingPromise(nextFlushPromise)

    allSettled([nextFlushPromise]).then(() => {
      // If there are no others waiting to flush, clear the promise.
      // We don't strictly need to do this, but it could make debugging easier
      if (this.flushPromise === nextFlushPromise) {
        this.flushPromise = null
      }
    })

    return nextFlushPromise
  }

  protected getCustomHeaders(): { [key: string]: string } {
    // Don't set the user agent if we're not on a browser. The latest spec allows
    // the User-Agent header (see https://fetch.spec.whatwg.org/#terminology-headers
    // and https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/setRequestHeader),
    // but browsers such as Chrome and Safari have not caught up.
    const customUserAgent = this.getCustomUserAgent()
    const headers: { [key: string]: string } = {}
    if (customUserAgent && customUserAgent !== '') {
      headers['User-Agent'] = customUserAgent
    }
    return headers
  }

  private async _flush(): Promise<void> {
    this.clearFlushTimer()
    await this._initPromise

    let queue = this.getPersistedProperty<PostHogQueueItem[]>(PostHogPersistedProperty.Queue) || []

    if (!queue.length) {
      return
    }

    const sentMessages: any[] = []
    const originalQueueLength = queue.length

    while (queue.length > 0 && sentMessages.length < originalQueueLength) {
      const batchItems = queue.slice(0, this.maxBatchSize)
      const batchMessages = batchItems.map((item) => item.message)

      const persistQueueChange = (): void => {
        const refreshedQueue = this.getPersistedProperty<PostHogQueueItem[]>(PostHogPersistedProperty.Queue) || []
        const newQueue = refreshedQueue.slice(batchItems.length)
        this.setPersistedProperty<PostHogQueueItem[]>(PostHogPersistedProperty.Queue, newQueue)
        queue = newQueue
      }

      const data: Record<string, any> = {
        api_key: this.apiKey,
        batch: batchMessages,
        sent_at: currentISOTime(),
      }

      if (this.historicalMigration) {
        data.historical_migration = true
      }

      const payload = JSON.stringify(data)

      const url = `${this.host}/batch/`

      const gzippedPayload = !this.disableCompression ? await gzipCompress(payload, this.isDebug) : null
      const fetchOptions: PostHogFetchOptions = {
        method: 'POST',
        headers: {
          ...this.getCustomHeaders(),
          'Content-Type': 'application/json',
          ...(gzippedPayload !== null && { 'Content-Encoding': 'gzip' }),
        },
        body: gzippedPayload || payload,
      }

      const retryOptions: Partial<RetriableOptions> = {
        retryCheck: (err) => {
          // don't automatically retry on 413 errors, we want to reduce the batch size first
          if (isPostHogFetchContentTooLargeError(err)) {
            return false
          }
          // otherwise, retry on network errors
          return isPostHogFetchError(err)
        },
      }

      try {
        await this.fetchWithRetry(url, fetchOptions, retryOptions)
      } catch (err) {
        if (isPostHogFetchContentTooLargeError(err) && batchMessages.length > 1) {
          // if we get a 413 error, we want to reduce the batch size and try again
          this.maxBatchSize = Math.max(1, Math.floor(batchMessages.length / 2))
          this.logMsgIfDebug(() =>
            console.warn(
              `Received 413 when sending batch of size ${batchMessages.length}, reducing batch size to ${this.maxBatchSize}`
            )
          )
          // do not persist the queue change, we want to retry the same batch
          continue
        }

        // depending on the error type, eg a malformed JSON or broken queue, it'll always return an error
        // and this will be an endless loop, in this case, if the error isn't a network issue, we always remove the items from the queue
        if (!(err instanceof PostHogFetchNetworkError)) {
          persistQueueChange()
        }
        this._events.emit('error', err)

        throw err
      }

      persistQueueChange()

      sentMessages.push(...batchMessages)
    }
    this._events.emit('flush', sentMessages)
  }

  private async fetchWithRetry(
    url: string,
    options: PostHogFetchOptions,
    retryOptions?: Partial<RetriableOptions>,
    requestTimeout?: number
  ): Promise<PostHogFetchResponse> {
    ;(AbortSignal as any).timeout ??= function timeout(ms: number) {
      const ctrl = new AbortController()
      setTimeout(() => ctrl.abort(), ms)
      return ctrl.signal
    }

    const body = options.body ? options.body : ''
    let reqByteLength = -1
    try {
      if (body instanceof Blob) {
        reqByteLength = body.size
      } else {
        reqByteLength = Buffer.byteLength(body, STRING_FORMAT)
      }
    } catch {
      if (body instanceof Blob) {
        reqByteLength = body.size
      } else {
        const encoded = new TextEncoder().encode(body)
        reqByteLength = encoded.length
      }
    }

    return await retriable(
      async () => {
        let res: PostHogFetchResponse | null = null
        try {
          res = await this.fetch(url, {
            signal: (AbortSignal as any).timeout(requestTimeout ?? this.requestTimeout),
            ...options,
          })
        } catch (e) {
          // fetch will only throw on network errors or on timeouts
          throw new PostHogFetchNetworkError(e)
        }
        // If we're in no-cors mode, we can't access the response status
        // We only throw on HTTP errors if we're not in no-cors mode
        // https://developer.mozilla.org/en-US/docs/Web/API/Request/mode#no-cors
        const isNoCors = options.mode === 'no-cors'
        if (!isNoCors && (res.status < 200 || res.status >= 400)) {
          throw new PostHogFetchHttpError(res, reqByteLength)
        }
        return res
      },
      { ...this._retryOptions, ...retryOptions }
    )
  }

  async _shutdown(shutdownTimeoutMs: number = 30000): Promise<void> {
    // A little tricky - we want to have a max shutdown time and enforce it, even if that means we have some
    // dangling promises. We'll keep track of the timeout and resolve/reject based on that.

    await this._initPromise
    let hasTimedOut = false
    this.clearFlushTimer()

    const doShutdown = async (): Promise<void> => {
      try {
        await Promise.all(Object.values(this.pendingPromises))

        while (true) {
          const queue = this.getPersistedProperty<PostHogQueueItem[]>(PostHogPersistedProperty.Queue) || []

          if (queue.length === 0) {
            break
          }

          // flush again to make sure we send all events, some of which might've been added
          // while we were waiting for the pending promises to resolve
          // For example, see sendFeatureFlags in posthog-node/src/posthog-node.ts::capture
          await this.flush()

          if (hasTimedOut) {
            break
          }
        }
      } catch (e) {
        if (!isPostHogFetchError(e)) {
          throw e
        }

        await logFlushError(e)
      }
    }

    return Promise.race([
      new Promise<void>((_, reject) => {
        safeSetTimeout(() => {
          this.logMsgIfDebug(() => console.error('Timed out while shutting down PostHog'))
          hasTimedOut = true
          reject('Timeout while shutting down PostHog. Some events may not have been sent.')
        }, shutdownTimeoutMs)
      }),
      doShutdown(),
    ])
  }

  /**
   *  Call shutdown() once before the node process exits, so ensure that all events have been sent and all promises
   *  have resolved. Do not use this function if you intend to keep using this PostHog instance after calling it.
   * @param shutdownTimeoutMs
   */
  async shutdown(shutdownTimeoutMs: number = 30000): Promise<void> {
    if (this.shutdownPromise) {
      this.logMsgIfDebug(() =>
        console.warn(
          'shutdown() called while already shutting down. shutdown() is meant to be called once before process exit - use flush() for per-request cleanup'
        )
      )
    } else {
      this.shutdownPromise = this._shutdown(shutdownTimeoutMs).finally(() => {
        this.shutdownPromise = null
      })
    }
    return this.shutdownPromise
  }
}

export abstract class PostHogCore extends PostHogCoreStateless {
  // options
  private sendFeatureFlagEvent: boolean
  private flagCallReported: { [key: string]: boolean } = {}

  // internal
  protected _flagsResponsePromise?: Promise<PostHogFlagsResponse | undefined> // TODO: come back to this, fix typing
  protected _sessionExpirationTimeSeconds: number
  private _sessionMaxLengthSeconds: number = 24 * 60 * 60 // 24 hours
  protected sessionProps: PostHogEventProperties = {}

  constructor(apiKey: string, options?: PostHogCoreOptions) {
    // Default for stateful mode is to not disable geoip. Only override if explicitly set
    const disableGeoipOption = options?.disableGeoip ?? false

    // Default for stateful mode is to timeout at 10s. Only override if explicitly set
    const featureFlagsRequestTimeoutMs = options?.featureFlagsRequestTimeoutMs ?? 10000 // 10 seconds

    super(apiKey, { ...options, disableGeoip: disableGeoipOption, featureFlagsRequestTimeoutMs })

    this.sendFeatureFlagEvent = options?.sendFeatureFlagEvent ?? true
    this._sessionExpirationTimeSeconds = options?.sessionExpirationTimeSeconds ?? 1800 // 30 minutes
  }

  protected setupBootstrap(options?: Partial<PostHogCoreOptions>): void {
    const bootstrap = options?.bootstrap
    if (!bootstrap) {
      return
    }

    // bootstrap options are only set if no persisted values are found
    // this is to prevent overwriting existing values
    if (bootstrap.distinctId) {
      if (bootstrap.isIdentifiedId) {
        const distinctId = this.getPersistedProperty(PostHogPersistedProperty.DistinctId)

        if (!distinctId) {
          this.setPersistedProperty(PostHogPersistedProperty.DistinctId, bootstrap.distinctId)
        }
      } else {
        const anonymousId = this.getPersistedProperty(PostHogPersistedProperty.AnonymousId)

        if (!anonymousId) {
          this.setPersistedProperty(PostHogPersistedProperty.AnonymousId, bootstrap.distinctId)
        }
      }
    }

    const bootstrapFeatureFlags = bootstrap.featureFlags
    const bootstrapFeatureFlagPayloads = bootstrap.featureFlagPayloads ?? {}
    if (bootstrapFeatureFlags && Object.keys(bootstrapFeatureFlags).length) {
      const normalizedBootstrapFeatureFlagDetails = createFlagsResponseFromFlagsAndPayloads(
        bootstrapFeatureFlags,
        bootstrapFeatureFlagPayloads
      )

      if (Object.keys(normalizedBootstrapFeatureFlagDetails.flags).length > 0) {
        this.setBootstrappedFeatureFlagDetails(normalizedBootstrapFeatureFlagDetails)

        const currentFeatureFlagDetails = this.getKnownFeatureFlagDetails() || { flags: {}, requestId: undefined }
        const newFeatureFlagDetails = {
          flags: {
            ...normalizedBootstrapFeatureFlagDetails.flags,
            ...currentFeatureFlagDetails.flags,
          },
          requestId: normalizedBootstrapFeatureFlagDetails.requestId,
        }

        this.setKnownFeatureFlagDetails(newFeatureFlagDetails)
      }
    }
  }

  private clearProps(): void {
    this.props = undefined
    this.sessionProps = {}
    this.flagCallReported = {}
  }

  on(event: string, cb: (...args: any[]) => void): () => void {
    return this._events.on(event, cb)
  }

  reset(propertiesToKeep?: PostHogPersistedProperty[]): void {
    this.wrap(() => {
      const allPropertiesToKeep = [PostHogPersistedProperty.Queue, ...(propertiesToKeep || [])]

      // clean up props
      this.clearProps()

      for (const key of <(keyof typeof PostHogPersistedProperty)[]>Object.keys(PostHogPersistedProperty)) {
        if (!allPropertiesToKeep.includes(PostHogPersistedProperty[key])) {
          this.setPersistedProperty((PostHogPersistedProperty as any)[key], null)
        }
      }

      this.reloadFeatureFlags()
    })
  }

  protected getCommonEventProperties(): PostHogEventProperties {
    const featureFlags = this.getFeatureFlags()

    const featureVariantProperties: Record<string, FeatureFlagValue> = {}
    if (featureFlags) {
      for (const [feature, variant] of Object.entries(featureFlags)) {
        featureVariantProperties[`$feature/${feature}`] = variant
      }
    }
    return {
      ...maybeAdd('$active_feature_flags', featureFlags ? Object.keys(featureFlags) : undefined),
      ...featureVariantProperties,
      ...super.getCommonEventProperties(),
    }
  }

  private enrichProperties(properties?: PostHogEventProperties): PostHogEventProperties {
    return {
      ...this.props, // Persisted properties first
      ...this.sessionProps, // Followed by session properties
      ...(properties || {}), // Followed by user specified properties
      ...this.getCommonEventProperties(), // Followed by FF props
      $session_id: this.getSessionId(),
    }
  }

  /**
   * * @returns {string} The stored session ID for the current session. This may be an empty string if the client is not yet fully initialized.
   */
  getSessionId(): string {
    if (!this._isInitialized) {
      return ''
    }

    let sessionId = this.getPersistedProperty<string>(PostHogPersistedProperty.SessionId)
    const sessionLastTimestamp = this.getPersistedProperty<number>(PostHogPersistedProperty.SessionLastTimestamp) || 0
    const sessionStartTimestamp = this.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp) || 0
    const now = Date.now()
    const sessionLastDif = now - sessionLastTimestamp
    const sessionStartDif = now - sessionStartTimestamp
    if (
      !sessionId ||
      sessionLastDif > this._sessionExpirationTimeSeconds * 1000 ||
      sessionStartDif > this._sessionMaxLengthSeconds * 1000
    ) {
      sessionId = uuidv7()
      this.setPersistedProperty(PostHogPersistedProperty.SessionId, sessionId)
      this.setPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp, now)
    }
    this.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, now)

    return sessionId
  }

  resetSessionId(): void {
    this.wrap(() => {
      this.setPersistedProperty(PostHogPersistedProperty.SessionId, null)
      this.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, null)
      this.setPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp, null)
    })
  }

  /**
   * * @returns {string} The stored anonymous ID. This may be an empty string if the client is not yet fully initialized.
   */
  getAnonymousId(): string {
    if (!this._isInitialized) {
      return ''
    }

    let anonId = this.getPersistedProperty<string>(PostHogPersistedProperty.AnonymousId)
    if (!anonId) {
      anonId = uuidv7()
      this.setPersistedProperty(PostHogPersistedProperty.AnonymousId, anonId)
    }
    return anonId
  }

  /**
   * * @returns {string} The stored distinct ID. This may be an empty string if the client is not yet fully initialized.
   */
  getDistinctId(): string {
    if (!this._isInitialized) {
      return ''
    }

    return this.getPersistedProperty<string>(PostHogPersistedProperty.DistinctId) || this.getAnonymousId()
  }

  registerForSession(properties: PostHogEventProperties): void {
    this.sessionProps = {
      ...this.sessionProps,
      ...properties,
    }
  }

  unregisterForSession(property: string): void {
    delete this.sessionProps[property]
  }

  /***
   *** TRACKING
   ***/
  identify(distinctId?: string, properties?: PostHogEventProperties, options?: PostHogCaptureOptions): void {
    this.wrap(() => {
      const previousDistinctId = this.getDistinctId()
      distinctId = distinctId || previousDistinctId

      if (properties?.$groups) {
        this.groups(properties.$groups as PostHogGroupProperties)
      }

      // promote $set and $set_once to top level
      const userPropsOnce = properties?.$set_once
      delete properties?.$set_once

      // if no $set is provided we assume all properties are $set
      const userProps = properties?.$set || properties

      const allProperties = this.enrichProperties({
        $anon_distinct_id: this.getAnonymousId(),
        ...maybeAdd('$set', userProps),
        ...maybeAdd('$set_once', userPropsOnce),
      })

      if (distinctId !== previousDistinctId) {
        // We keep the AnonymousId to be used by flags calls and identify to link the previousId
        this.setPersistedProperty(PostHogPersistedProperty.AnonymousId, previousDistinctId)
        this.setPersistedProperty(PostHogPersistedProperty.DistinctId, distinctId)
        this.reloadFeatureFlags()
      }

      super.identifyStateless(distinctId, allProperties, options)
    })
  }

  capture(event: string, properties?: PostHogEventProperties, options?: PostHogCaptureOptions): void {
    this.wrap(() => {
      const distinctId = this.getDistinctId()

      if (properties?.$groups) {
        this.groups(properties.$groups as PostHogGroupProperties)
      }

      const allProperties = this.enrichProperties(properties)

      super.captureStateless(distinctId, event, allProperties, options)
    })
  }

  alias(alias: string): void {
    this.wrap(() => {
      const distinctId = this.getDistinctId()
      const allProperties = this.enrichProperties({})

      super.aliasStateless(alias, distinctId, allProperties)
    })
  }

  autocapture(
    eventType: string,
    elements: PostHogAutocaptureElement[],
    properties: PostHogEventProperties = {},
    options?: PostHogCaptureOptions
  ): void {
    this.wrap(() => {
      const distinctId = this.getDistinctId()
      const payload = {
        distinct_id: distinctId,
        event: '$autocapture',
        properties: {
          ...this.enrichProperties(properties),
          $event_type: eventType,
          $elements: elements,
        },
      }

      this.enqueue('autocapture', payload, options)
    })
  }

  /***
   *** GROUPS
   ***/

  groups(groups: PostHogGroupProperties): void {
    this.wrap(() => {
      // Get persisted groups
      const existingGroups = this.props.$groups || {}

      this.register({
        $groups: {
          ...(existingGroups as PostHogGroupProperties),
          ...groups,
        },
      })

      if (Object.keys(groups).find((type) => existingGroups[type as keyof typeof existingGroups] !== groups[type])) {
        this.reloadFeatureFlags()
      }
    })
  }

  group(
    groupType: string,
    groupKey: string | number,
    groupProperties?: PostHogEventProperties,
    options?: PostHogCaptureOptions
  ): void {
    this.wrap(() => {
      this.groups({
        [groupType]: groupKey,
      })

      if (groupProperties) {
        this.groupIdentify(groupType, groupKey, groupProperties, options)
      }
    })
  }

  groupIdentify(
    groupType: string,
    groupKey: string | number,
    groupProperties?: PostHogEventProperties,
    options?: PostHogCaptureOptions
  ): void {
    this.wrap(() => {
      const distinctId = this.getDistinctId()
      const eventProperties = this.enrichProperties({})
      super.groupIdentifyStateless(groupType, groupKey, groupProperties, options, distinctId, eventProperties)
    })
  }

  /***
   * PROPERTIES
   ***/
  setPersonPropertiesForFlags(properties: { [type: string]: string }): void {
    this.wrap(() => {
      // Get persisted person properties
      const existingProperties =
        this.getPersistedProperty<Record<string, string>>(PostHogPersistedProperty.PersonProperties) || {}

      this.setPersistedProperty<PostHogEventProperties>(PostHogPersistedProperty.PersonProperties, {
        ...existingProperties,
        ...properties,
      })
    })
  }

  resetPersonPropertiesForFlags(): void {
    this.wrap(() => {
      this.setPersistedProperty<PostHogEventProperties>(PostHogPersistedProperty.PersonProperties, null)
    })
  }

  setGroupPropertiesForFlags(properties: { [type: string]: Record<string, string> }): void {
    this.wrap(() => {
      // Get persisted group properties
      const existingProperties =
        this.getPersistedProperty<Record<string, Record<string, string>>>(PostHogPersistedProperty.GroupProperties) ||
        {}

      if (Object.keys(existingProperties).length !== 0) {
        Object.keys(existingProperties).forEach((groupType) => {
          existingProperties[groupType] = {
            ...existingProperties[groupType],
            ...properties[groupType],
          }
          delete properties[groupType]
        })
      }

      this.setPersistedProperty<PostHogEventProperties>(PostHogPersistedProperty.GroupProperties, {
        ...existingProperties,
        ...properties,
      })
    })
  }

  resetGroupPropertiesForFlags(): void {
    this.wrap(() => {
      this.setPersistedProperty<PostHogEventProperties>(PostHogPersistedProperty.GroupProperties, null)
    })
  }

  private async remoteConfigAsync(): Promise<PostHogRemoteConfig | undefined> {
    await this._initPromise
    if (this._remoteConfigResponsePromise) {
      return this._remoteConfigResponsePromise
    }
    return this._remoteConfigAsync()
  }

  /***
   *** FEATURE FLAGS
   ***/
  private async flagsAsync(sendAnonDistinctId: boolean = true): Promise<PostHogFlagsResponse | undefined> {
    await this._initPromise
    if (this._flagsResponsePromise) {
      return this._flagsResponsePromise
    }
    return this._flagsAsync(sendAnonDistinctId)
  }

  private cacheSessionReplay(source: string, response?: PostHogRemoteConfig): void {
    const sessionReplay = response?.sessionRecording
    if (sessionReplay) {
      this.setPersistedProperty(PostHogPersistedProperty.SessionReplay, sessionReplay)
      this.logMsgIfDebug(() =>
        console.log('PostHog Debug', `Session replay config from ${source}: `, JSON.stringify(sessionReplay))
      )
    } else if (typeof sessionReplay === 'boolean' && sessionReplay === false) {
      // if session replay is disabled, we don't need to cache it
      // we need to check for this because the response might be undefined (/flags does not return sessionRecording yet)
      this.logMsgIfDebug(() => console.info('PostHog Debug', `Session replay config from ${source} disabled.`))
      this.setPersistedProperty(PostHogPersistedProperty.SessionReplay, null)
    }
  }

  private async _remoteConfigAsync(): Promise<PostHogRemoteConfig | undefined> {
    this._remoteConfigResponsePromise = this._initPromise
      .then(() => {
        let remoteConfig = this.getPersistedProperty<Omit<PostHogRemoteConfig, 'surveys'>>(
          PostHogPersistedProperty.RemoteConfig
        )

        this.logMsgIfDebug(() => console.log('PostHog Debug', 'Cached remote config: ', JSON.stringify(remoteConfig)))

        return super.getRemoteConfig().then((response) => {
          if (response) {
            const remoteConfigWithoutSurveys = { ...response }
            delete remoteConfigWithoutSurveys.surveys

            this.logMsgIfDebug(() =>
              console.log('PostHog Debug', 'Fetched remote config: ', JSON.stringify(remoteConfigWithoutSurveys))
            )

            if (this.disableSurveys === false) {
              const surveys = response.surveys

              let hasSurveys = true

              if (!Array.isArray(surveys)) {
                // If surveys is not an array, it means there are no surveys (its a boolean instead)
                this.logMsgIfDebug(() => console.log('PostHog Debug', 'There are no surveys.'))
                hasSurveys = false
              } else {
                this.logMsgIfDebug(() =>
                  console.log('PostHog Debug', 'Surveys fetched from remote config: ', JSON.stringify(surveys))
                )
              }

              if (hasSurveys) {
                this.setPersistedProperty<SurveyResponse['surveys']>(
                  PostHogPersistedProperty.Surveys,
                  surveys as Survey[]
                )
              } else {
                this.setPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys, null)
              }
            } else {
              this.setPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys, null)
            }
            // we cache the surveys in its own storage key
            this.setPersistedProperty<Omit<PostHogRemoteConfig, 'surveys'>>(
              PostHogPersistedProperty.RemoteConfig,
              remoteConfigWithoutSurveys
            )

            this.cacheSessionReplay('remote config', response)

            // we only dont load flags if the remote config has no feature flags
            if (response.hasFeatureFlags === false) {
              // resetting flags to empty object
              this.setKnownFeatureFlagDetails({ flags: {} })

              this.logMsgIfDebug(() => console.warn('Remote config has no feature flags, will not load feature flags.'))
            } else if (this.preloadFeatureFlags !== false) {
              this.reloadFeatureFlags()
            }

            if (!response.supportedCompression?.includes(Compression.GZipJS)) {
              this.disableCompression = true
            }

            remoteConfig = response
          }

          return remoteConfig
        })
      })
      .finally(() => {
        this._remoteConfigResponsePromise = undefined
      })
    return this._remoteConfigResponsePromise
  }

  private async _flagsAsync(sendAnonDistinctId: boolean = true): Promise<PostHogFlagsResponse | undefined> {
    this._flagsResponsePromise = this._initPromise
      .then(async () => {
        const distinctId = this.getDistinctId()
        const groups = this.props.$groups || {}
        const personProperties =
          this.getPersistedProperty<Record<string, string>>(PostHogPersistedProperty.PersonProperties) || {}
        const groupProperties =
          this.getPersistedProperty<Record<string, Record<string, string>>>(PostHogPersistedProperty.GroupProperties) ||
          {}

        const extraProperties = {
          $anon_distinct_id: sendAnonDistinctId ? this.getAnonymousId() : undefined,
        }

        const res = await super.getFlags(
          distinctId,
          groups as PostHogGroupProperties,
          personProperties,
          groupProperties,
          extraProperties
        )
        // Add check for quota limitation on feature flags
        if (res?.quotaLimited?.includes(QuotaLimitedFeature.FeatureFlags)) {
          // Unset all feature flags by setting to null
          this.setKnownFeatureFlagDetails(null)
          console.warn(
            '[FEATURE FLAGS] Feature flags quota limit exceeded - unsetting all flags. Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts'
          )
          return res
        }
        if (res?.featureFlags) {
          // clear flag call reported if we have new flags since they might have changed
          if (this.sendFeatureFlagEvent) {
            this.flagCallReported = {}
          }

          let newFeatureFlagDetails = res
          if (res.errorsWhileComputingFlags) {
            // if not all flags were computed, we upsert flags instead of replacing them
            const currentFlagDetails = this.getKnownFeatureFlagDetails()
            this.logMsgIfDebug(() =>
              console.log('PostHog Debug', 'Cached feature flags: ', JSON.stringify(currentFlagDetails))
            )

            newFeatureFlagDetails = {
              ...res,
              flags: { ...currentFlagDetails?.flags, ...res.flags },
            }
          }
          this.setKnownFeatureFlagDetails(newFeatureFlagDetails)
          // Mark that we hit the /flags endpoint so we can capture this in the $feature_flag_called event
          this.setPersistedProperty(PostHogPersistedProperty.FlagsEndpointWasHit, true)
          this.cacheSessionReplay('flags', res)
        }
        return res
      })
      .finally(() => {
        this._flagsResponsePromise = undefined
      })
    return this._flagsResponsePromise
  }

  // We only store the flags and request id in the feature flag details storage key
  private setKnownFeatureFlagDetails(flagsResponse: PostHogFlagsStorageFormat | null): void {
    this.wrap(() => {
      this.setPersistedProperty<PostHogFlagsStorageFormat>(PostHogPersistedProperty.FeatureFlagDetails, flagsResponse)

      this._events.emit('featureflags', getFlagValuesFromFlags(flagsResponse?.flags ?? {}))
    })
  }

  private getKnownFeatureFlagDetails(): PostHogFeatureFlagDetails | undefined {
    const storedDetails = this.getPersistedProperty<PostHogFlagsStorageFormat>(
      PostHogPersistedProperty.FeatureFlagDetails
    )
    if (!storedDetails) {
      // Rebuild from the stored feature flags and feature flag payloads
      const featureFlags = this.getPersistedProperty<PostHogFlagsResponse['featureFlags']>(
        PostHogPersistedProperty.FeatureFlags
      )
      const featureFlagPayloads = this.getPersistedProperty<PostHogFlagsResponse['featureFlagPayloads']>(
        PostHogPersistedProperty.FeatureFlagPayloads
      )

      if (featureFlags === undefined && featureFlagPayloads === undefined) {
        return undefined
      }

      return createFlagsResponseFromFlagsAndPayloads(featureFlags ?? {}, featureFlagPayloads ?? {})
    }

    return normalizeFlagsResponse(
      storedDetails as PostHogV1FlagsResponse | PostHogV2FlagsResponse
    ) as PostHogFeatureFlagDetails
  }

  protected getKnownFeatureFlags(): PostHogFlagsResponse['featureFlags'] | undefined {
    const featureFlagDetails = this.getKnownFeatureFlagDetails()
    if (!featureFlagDetails) {
      return undefined
    }
    return getFlagValuesFromFlags(featureFlagDetails.flags)
  }

  private getKnownFeatureFlagPayloads(): PostHogFlagsResponse['featureFlagPayloads'] | undefined {
    const featureFlagDetails = this.getKnownFeatureFlagDetails()
    if (!featureFlagDetails) {
      return undefined
    }
    return getPayloadsFromFlags(featureFlagDetails.flags)
  }

  private getBootstrappedFeatureFlagDetails(): PostHogFeatureFlagDetails | undefined {
    const details = this.getPersistedProperty<PostHogFeatureFlagDetails>(
      PostHogPersistedProperty.BootstrapFeatureFlagDetails
    )
    if (!details) {
      return undefined
    }
    return details
  }

  private setBootstrappedFeatureFlagDetails(details: PostHogFeatureFlagDetails): void {
    this.setPersistedProperty<PostHogFeatureFlagDetails>(PostHogPersistedProperty.BootstrapFeatureFlagDetails, details)
  }

  private getBootstrappedFeatureFlags(): PostHogFlagsResponse['featureFlags'] | undefined {
    const details = this.getBootstrappedFeatureFlagDetails()
    if (!details) {
      return undefined
    }
    return getFlagValuesFromFlags(details.flags)
  }

  private getBootstrappedFeatureFlagPayloads(): PostHogFlagsResponse['featureFlagPayloads'] | undefined {
    const details = this.getBootstrappedFeatureFlagDetails()
    if (!details) {
      return undefined
    }
    return getPayloadsFromFlags(details.flags)
  }

  getFeatureFlag(key: string): FeatureFlagValue | undefined {
    const details = this.getFeatureFlagDetails()

    if (!details) {
      // If we haven't loaded flags yet, or errored out, we respond with undefined
      return undefined
    }

    const featureFlag = details.flags[key]

    let response = getFeatureFlagValue(featureFlag)

    if (response === undefined) {
      // For cases where the flag is unknown, return false
      response = false
    }

    if (this.sendFeatureFlagEvent && !this.flagCallReported[key]) {
      const bootstrappedResponse = this.getBootstrappedFeatureFlags()?.[key]
      const bootstrappedPayload = this.getBootstrappedFeatureFlagPayloads()?.[key]

      this.flagCallReported[key] = true
      this.capture('$feature_flag_called', {
        $feature_flag: key,
        $feature_flag_response: response,
        ...maybeAdd('$feature_flag_id', featureFlag?.metadata?.id),
        ...maybeAdd('$feature_flag_version', featureFlag?.metadata?.version),
        ...maybeAdd('$feature_flag_reason', featureFlag?.reason?.description ?? featureFlag?.reason?.code),
        ...maybeAdd('$feature_flag_bootstrapped_response', bootstrappedResponse),
        ...maybeAdd('$feature_flag_bootstrapped_payload', bootstrappedPayload),
        // If we haven't yet received a response from the /flags endpoint, we must have used the bootstrapped value
        $used_bootstrap_value: !this.getPersistedProperty(PostHogPersistedProperty.FlagsEndpointWasHit),
        ...maybeAdd('$feature_flag_request_id', details.requestId),
      })
    }

    // If we have flags we either return the value (true or string) or false
    return response
  }

  getFeatureFlagPayload(key: string): JsonType | undefined {
    const payloads = this.getFeatureFlagPayloads()

    if (!payloads) {
      return undefined
    }

    const response = payloads[key]

    // Undefined means a loading or missing data issue. Null means evaluation happened and there was no match
    if (response === undefined) {
      return null
    }

    return response
  }

  getFeatureFlagPayloads(): PostHogFlagsResponse['featureFlagPayloads'] | undefined {
    return this.getFeatureFlagDetails()?.featureFlagPayloads
  }

  getFeatureFlags(): PostHogFlagsResponse['featureFlags'] | undefined {
    // NOTE: We don't check for _initPromise here as the function is designed to be
    // callable before the state being loaded anyways
    return this.getFeatureFlagDetails()?.featureFlags
  }

  getFeatureFlagDetails(): PostHogFeatureFlagDetails | undefined {
    // NOTE: We don't check for _initPromise here as the function is designed to be
    // callable before the state being loaded anyways
    let details = this.getKnownFeatureFlagDetails()
    const overriddenFlags = this.getPersistedProperty<PostHogFlagsResponse['featureFlags']>(
      PostHogPersistedProperty.OverrideFeatureFlags
    )

    if (!overriddenFlags) {
      return details
    }

    details = details ?? { featureFlags: {}, featureFlagPayloads: {}, flags: {} }

    const flags: Record<string, FeatureFlagDetail> = details.flags ?? {}

    for (const key in overriddenFlags) {
      if (!overriddenFlags[key]) {
        delete flags[key]
      } else {
        flags[key] = updateFlagValue(flags[key], overriddenFlags[key])
      }
    }

    const result = {
      ...details,
      flags,
    }

    return normalizeFlagsResponse(result) as PostHogFeatureFlagDetails
  }

  getFeatureFlagsAndPayloads(): {
    flags: PostHogFlagsResponse['featureFlags'] | undefined
    payloads: PostHogFlagsResponse['featureFlagPayloads'] | undefined
  } {
    const flags = this.getFeatureFlags()
    const payloads = this.getFeatureFlagPayloads()

    return {
      flags,
      payloads,
    }
  }

  isFeatureEnabled(key: string): boolean | undefined {
    const response = this.getFeatureFlag(key)
    if (response === undefined) {
      return undefined
    }
    return !!response
  }

  // Used when we want to trigger the reload but we don't care about the result
  reloadFeatureFlags(options?: { cb?: (err?: Error, flags?: PostHogFlagsResponse['featureFlags']) => void }): void {
    this.flagsAsync(true)
      .then((res) => {
        options?.cb?.(undefined, res?.featureFlags)
      })
      .catch((e) => {
        options?.cb?.(e, undefined)
        if (!options?.cb) {
          this.logMsgIfDebug(() => console.log('PostHog Debug', 'Error reloading feature flags', e))
        }
      })
  }

  async reloadRemoteConfigAsync(): Promise<PostHogRemoteConfig | undefined> {
    return await this.remoteConfigAsync()
  }

  async reloadFeatureFlagsAsync(
    sendAnonDistinctId?: boolean
  ): Promise<PostHogFlagsResponse['featureFlags'] | undefined> {
    return (await this.flagsAsync(sendAnonDistinctId ?? true))?.featureFlags
  }

  onFeatureFlags(cb: (flags: PostHogFlagsResponse['featureFlags']) => void): () => void {
    return this.on('featureflags', async () => {
      const flags = this.getFeatureFlags()
      if (flags) {
        cb(flags)
      }
    })
  }

  onFeatureFlag(key: string, cb: (value: FeatureFlagValue) => void): () => void {
    return this.on('featureflags', async () => {
      const flagResponse = this.getFeatureFlag(key)
      if (flagResponse !== undefined) {
        cb(flagResponse)
      }
    })
  }

  async overrideFeatureFlag(flags: PostHogFlagsResponse['featureFlags'] | null): Promise<void> {
    this.wrap(() => {
      if (flags === null) {
        return this.setPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags, null)
      }
      return this.setPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags, flags)
    })
  }

  /***
   *** ERROR TRACKING
   ***/
  captureException(error: unknown, additionalProperties?: PostHogEventProperties): void {
    const properties: { [key: string]: any } = {
      $exception_level: 'error',
      $exception_list: [
        {
          type: isError(error) ? error.name : 'Error',
          value: isError(error) ? error.message : error,
          mechanism: {
            handled: true,
            synthetic: false,
          },
        },
      ],
      ...additionalProperties,
    }

    properties.$exception_personURL = new URL(
      `/project/${this.apiKey}/person/${this.getDistinctId()}`,
      this.host
    ).toString()

    this.capture('$exception', properties)
  }

  /**
   * Capture written user feedback for a LLM trace. Numeric values are converted to strings.
   * @param traceId The trace ID to capture feedback for.
   * @param userFeedback The feedback to capture.
   */
  captureTraceFeedback(traceId: string | number, userFeedback: string): void {
    this.capture('$ai_feedback', {
      $ai_feedback_text: userFeedback,
      $ai_trace_id: String(traceId),
    })
  }

  /**
   * Capture a metric for a LLM trace. Numeric values are converted to strings.
   * @param traceId The trace ID to capture the metric for.
   * @param metricName The name of the metric to capture.
   * @param metricValue The value of the metric to capture.
   */
  captureTraceMetric(traceId: string | number, metricName: string, metricValue: string | number | boolean): void {
    this.capture('$ai_metric', {
      $ai_metric_name: metricName,
      $ai_metric_value: String(metricValue),
      $ai_trace_id: String(traceId),
    })
  }
}

export * from './types'
