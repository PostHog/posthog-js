import { AppState, Dimensions, Linking, Platform } from 'react-native'

import {
  JsonType,
  PostHogCaptureOptions,
  PostHogCore,
  PostHogCoreOptions,
  PostHogEventProperties,
  PostHogFetchOptions,
  PostHogFetchResponse,
  PostHogPersistedProperty,
  SurveyResponse,
  logFlushError,
  maybeAdd,
  FeatureFlagValue,
} from '@posthog/core'
import { PostHogRNStorage, PostHogRNSyncMemoryStorage } from './storage'
import { version } from './version'
import { buildOptimisiticAsyncStorage, getAppProperties } from './native-deps'
import {
  PostHogAutocaptureOptions,
  PostHogCustomAppProperties,
  PostHogCustomStorage,
  PostHogSessionReplayConfig,
} from './types'
import { withReactNativeNavigation } from './frameworks/wix-navigation'
import { OptionalReactNativeSessionReplay } from './optional/OptionalSessionReplay'
import { ErrorTracking, ErrorTrackingOptions } from './error-tracking'

export { PostHogPersistedProperty }

export interface PostHogOptions extends PostHogCoreOptions {
  /** Allows you to provide the storage type. By default 'file'.
   * 'file' will try to load the best available storage, the provided 'customStorage', 'customAsyncStorage' or in-memory storage.
   */
  persistence?: 'memory' | 'file'
  /** Allows you to provide your own implementation of the common information about your App or a function to modify the default App properties generated */
  customAppProperties?:
    | PostHogCustomAppProperties
    | ((properties: PostHogCustomAppProperties) => PostHogCustomAppProperties)
  /** Allows you to provide a custom asynchronous storage such as async-storage, expo-file-system or a synchronous storage such as mmkv.
   * If not provided, PostHog will attempt to use the best available storage via optional peer dependencies (async-storage, expo-file-system).
   * If `persistence` is set to 'memory', this option will be ignored.
   */
  customStorage?: PostHogCustomStorage

  /** Captures app lifecycle events such as Application Installed, Application Updated, Application Opened, Application Became Active and Application Backgrounded.
   * By default is false.
   * Application Installed and Application Updated events are not supported with persistence set to 'memory'.
   */
  captureAppLifecycleEvents?: boolean

  /**
   * Enable Recording of Session Replays for Android and iOS
   * Requires Record user sessions to be enabled in the PostHog Project Settings
   * Defaults to false
   */
  enableSessionReplay?: boolean

  /**
   * Configuration for Session Replay
   */
  sessionReplayConfig?: PostHogSessionReplayConfig

  /**
   * If enabled, the session id ($session_id) will be persisted across app restarts.
   * This is an option for back compatibility, so your current data isn't skewed with the new version of the SDK.
   * If this is false, the session id will be always reset on app restart.
   * Defaults to false
   */
  enablePersistSessionIdAcrossRestart?: boolean

  /**
   * Error Tracking Configuration
   */
  errorTracking?: ErrorTrackingOptions
}

export class PostHog extends PostHogCore {
  private _persistence: PostHogOptions['persistence']
  private _storage: PostHogRNStorage
  private _appProperties: PostHogCustomAppProperties = {}
  private _currentSessionId?: string | undefined
  private _enableSessionReplay?: boolean
  private _disableSurveys: boolean
  private _disableRemoteConfig: boolean
  private _errorTracking: ErrorTracking

  /**
   * Creates a new PostHog instance for React Native. You can find all configuration options in the [React Native SDK docs](https://posthog.com/docs/libraries/react-native#configuration-options).
   *
   * If you prefer not to use the PostHogProvider, you can initialize PostHog in its own file and import the instance from there.
   *
   * {@label Initialization}
   *
   * @example
   * ```ts
   * // posthog.ts
   * import PostHog from 'posthog-react-native'
   *
   * export const posthog = new PostHog('<ph_project_api_key>', {
   *   host: '<ph_client_api_host>'
   * })
   *
   * // Then you can access PostHog by importing your instance
   * // Another file:
   * import { posthog } from './posthog'
   *
   * export function MyApp1() {
   *     useEffect(async () => {
   *         posthog.capture('event_name')
   *     }, [posthog])
   *
   *     return <View>Your app code</View>
   * }
   * ```
   *
   * @public
   *
   * @param apiKey - Your PostHog API key
   * @param options - PostHog configuration options
   */
  constructor(apiKey: string, options?: PostHogOptions) {
    super(apiKey, options)
    this._isInitialized = false
    this._persistence = options?.persistence ?? 'file'
    this._disableSurveys = options?.disableSurveys ?? false
    this._disableRemoteConfig = options?.disableRemoteConfig ?? false
    this._errorTracking = new ErrorTracking(this, options?.errorTracking, this._logger)

    // Either build the app properties from the existing ones
    this._appProperties =
      typeof options?.customAppProperties === 'function'
        ? options.customAppProperties(getAppProperties())
        : options?.customAppProperties || getAppProperties()

    AppState.addEventListener('change', (state) => {
      // ignore unknown state (usually initial state, the app might not be ready yet)
      if (state === 'unknown') {
        return
      }

      void this.flush().catch(async (err) => {
        await logFlushError(err)
      })

      if (state === 'active') {
        // rotate session id if needed (expired either 30 minutes inactive or max duration 24 hours)
        this.getSessionId()
      }
    })

    let storagePromise: Promise<void> | undefined

    if (this._persistence === 'file') {
      this._storage = new PostHogRNStorage(options?.customStorage ?? buildOptimisiticAsyncStorage())
      storagePromise = this._storage.preloadPromise
    } else {
      this._storage = new PostHogRNSyncMemoryStorage()
    }

    if (storagePromise) {
      storagePromise.catch((error) => {
        console.error('PostHog storage initialization failed:', error)
      })
    }

    const initAfterStorage = (): void => {
      // reset session id on app restart
      const enablePersistSessionIdAcrossRestart = options?.enablePersistSessionIdAcrossRestart
      if (!enablePersistSessionIdAcrossRestart) {
        this.setPersistedProperty(PostHogPersistedProperty.SessionId, null)
        this.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, null)
        this.setPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp, null)
      }

      this.setupBootstrap(options)

      this._isInitialized = true

      if (this._disableRemoteConfig === false) {
        this.reloadRemoteConfigAsync()
      } else {
        this._logger.info('Remote config is disabled.')
        if (options?.preloadFeatureFlags !== false) {
          this._logger.info('Feature flags will be preloaded from Flags API.')
          this.reloadFeatureFlags()
        } else {
          this._logger.info('preloadFeatureFlags is disabled.')
        }
      }

      if (options?.captureAppLifecycleEvents) {
        void this.captureAppLifecycleEvents()
      }

      void this.persistAppVersion()

      void this.startSessionReplay(options)
    }

    // For async storage, we wait for the storage to be ready before we start the SDK
    // For sync storage we can start the SDK immediately
    if (storagePromise) {
      this._initPromise = storagePromise.then(initAfterStorage)
    } else {
      this._initPromise = Promise.resolve()
      initAfterStorage()
    }
  }

  /**
   *
   * @internal
   *
   */
  public async ready(): Promise<void> {
    await this._initPromise
  }

  getPersistedProperty<T>(key: PostHogPersistedProperty): T | undefined {
    return this._storage.getItem(key) as T | undefined
  }

  setPersistedProperty<T>(key: PostHogPersistedProperty, value: T | null): void {
    return value !== null ? this._storage.setItem(key, value) : this._storage.removeItem(key)
  }

  fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
    return fetch(url, options)
  }

  getLibraryId(): string {
    return 'posthog-react-native'
  }

  getLibraryVersion(): string {
    return version
  }

  getCustomUserAgent(): string {
    if (Platform.OS === 'web') {
      return ''
    }
    return `${this.getLibraryId()}/${this.getLibraryVersion()}`
  }

  getCommonEventProperties(): PostHogEventProperties {
    return {
      ...super.getCommonEventProperties(),
      ...this._appProperties,
      $screen_height: Dimensions.get('screen').height,
      $screen_width: Dimensions.get('screen').width,
    }
  }

  /**
   * Registers super properties that are sent with every event.
   *
   * Super properties are properties associated with events that are set once and then sent with every capture call.
   * They persist across sessions and are stored locally.
   *
   * {@label Capture}
   *
   * @example
   * ```js
   * // register super properties
   * posthog.register({
   *     'icecream pref': 'vanilla',
   *     team_id: 22,
   * })
   * ```
   *
   * @public
   *
   * @param properties An associative array of properties to store about the user
   */
  register(properties: PostHogEventProperties): Promise<void> {
    return super.register(properties)
  }

  /**
   * Removes a super property so it won't be sent with future events.
   *
   * Super Properties are persisted across sessions so you have to explicitly remove them if they are no longer relevant.
   *
   * {@label Capture}
   *
   * @example
   * ```js
   * // remove a super property
   * posthog.unregister('icecream pref')
   * ```
   *
   * @public
   *
   * @param property The name of the super property to remove
   */
  unregister(property: string): Promise<void> {
    return super.unregister(property)
  }

  /**
   * Resets the user's ID and anonymous ID after logout.
   *
   * To reset the user's ID and anonymous ID, call reset. Usually you would do this right after the user logs out.
   * This also clears all stored super properties and more.
   *
   * {@label Identification}
   *
   * @example
   * ```js
   * // reset after logout
   * posthog.reset()
   * ```
   *
   * @public
   */
  reset(): void {
    super.reset()
  }

  /**
   * Manually flushes the event queue.
   *
   * You can set the number of events in the configuration that should queue before flushing.
   * Setting this to 1 will send events immediately and will use more battery. This is set to 20 by default.
   * You can also manually flush the queue. If a flush is already in progress it returns a promise for the existing flush.
   *
   * {@label Capture}
   *
   * @example
   * ```js
   * // manually flush the queue
   * await posthog.flush()
   * ```
   *
   * @public
   *
   * @returns Promise that resolves when the flush is complete
   */
  flush(): Promise<void> {
    return super.flush()
  }

  /**
   * Opts the user in to data capture.
   *
   * By default, PostHog has tracking enabled unless it is forcefully disabled by default using the option { defaultOptIn: false }.
   * Once this has been called it is persisted and will be respected until optOut is called again or the reset function is called.
   *
   * {@label Privacy}
   *
   * @example
   * ```js
   * // opt in to tracking
   * posthog.optIn()
   * ```
   *
   * @public
   */
  optIn(): Promise<void> {
    return super.optIn()
  }

  /**
   * Opts the user out of data capture.
   *
   * You can completely opt-out users from data capture. Once this has been called it is persisted and will be respected until optIn is called again or the reset function is called.
   *
   * {@label Privacy}
   *
   * @example
   * ```js
   * // opt out of tracking
   * posthog.optOut()
   * ```
   *
   * @public
   */
  optOut(): Promise<void> {
    return super.optOut()
  }

  /**
   * Checks if a feature flag is enabled for the current user.
   *
   * Defaults to undefined if not loaded yet or if there was a problem loading.
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // check if feature flag is enabled
   * const isEnabled = posthog.isFeatureEnabled('key-for-your-boolean-flag')
   * ```
   *
   * @public
   *
   * @param key The feature flag key
   * @returns True if enabled, false if disabled, undefined if not loaded
   */
  isFeatureEnabled(key: string): boolean | undefined {
    return super.isFeatureEnabled(key)
  }

  /**
   * Gets the value of a feature flag for the current user.
   *
   * Defaults to undefined if not loaded yet or if there was a problem loading.
   * Multivariant feature flags are returned as a string.
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // get feature flag value
   * const value = posthog.getFeatureFlag('key-for-your-boolean-flag')
   * ```
   *
   * @public
   *
   * @param key The feature flag key
   * @returns The feature flag value or undefined if not loaded
   */
  getFeatureFlag(key: string): boolean | string | undefined {
    return super.getFeatureFlag(key)
  }

  /**
   * Gets the payload of a feature flag for the current user.
   *
   * Returns JsonType or undefined if not loaded yet or if there was a problem loading.
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // get feature flag payload
   * const payload = posthog.getFeatureFlagPayload('key-for-your-multivariate-flag')
   * ```
   *
   * @public
   *
   * @param key The feature flag key
   * @returns The feature flag payload or undefined if not loaded
   */
  getFeatureFlagPayload(key: string): JsonType | undefined {
    return super.getFeatureFlagPayload(key)
  }

  /**
   * Reloads feature flags from the server.
   *
   * PostHog loads feature flags when instantiated and refreshes whenever methods are called that affect the flag.
   * If you want to manually trigger a refresh, you can call this method.
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // reload feature flags
   * posthog.reloadFeatureFlags()
   * ```
   *
   * @public
   */
  reloadFeatureFlags(): void {
    super.reloadFeatureFlags()
  }

  /**
   * Reloads feature flags from the server asynchronously.
   *
   * PostHog loads feature flags when instantiated and refreshes whenever methods are called that affect the flag.
   * If you want to manually trigger a refresh and get the result, you can call this method.
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // reload feature flags and get result
   * posthog.reloadFeatureFlagsAsync().then((refreshedFlags) => console.log(refreshedFlags))
   * ```
   *
   * @public
   *
   * @returns Promise that resolves with the refreshed flags
   */
  reloadFeatureFlagsAsync(): Promise<Record<string, boolean | string> | undefined> {
    return super.reloadFeatureFlagsAsync()
  }

  /**
   * Associates the current user with a group.
   *
   * Group analytics allows you to associate the events for that person's session with a group (e.g. teams, organizations, etc.).
   * This is a paid feature and is not available on the open-source or free cloud plan.
   *
   * {@label Group analytics}
   *
   * @example
   * ```js
   * // associate with a group
   * posthog.group('company', 'company_id_in_your_db')
   * ```
   *
   * @example
   * ```js
   * // associate with a group and update properties
   * posthog.group('company', 'company_id_in_your_db', {
   *   name: 'Awesome Inc.',
   *   employees: 11,
   * })
   * ```
   *
   * @public
   *
   * @param groupType The type of group (e.g. 'company', 'team')
   * @param groupKey The unique identifier for the group
   * @param properties Optional properties to set for the group
   */
  group(groupType: string, groupKey: string, properties?: PostHogEventProperties): void {
    super.group(groupType, groupKey, properties)
  }

  /**
   * Assigns an alias to the current user.
   *
   * Sometimes, you want to assign multiple distinct IDs to a single user. This is helpful when your primary distinct ID is inaccessible.
   * For example, if a distinct ID used on the frontend is not available in your backend.
   *
   * {@label Identification}
   *
   * @example
   * ```js
   * // set alias for current user
   * posthog.alias('distinct_id')
   * ```
   *
   * @public
   *
   * @param alias The alias to assign to the current user
   */
  alias(alias: string): void {
    super.alias(alias)
  }

  /**
   * Gets the current user's distinct ID.
   *
   * You may find it helpful to get the current user's distinct ID. For example, to check whether you've already called identify for a user or not.
   * This returns either the ID automatically generated by PostHog or the ID that has been passed by a call to identify().
   *
   * {@label Identification}
   *
   * @example
   * ```js
   * // get current distinct ID
   * const distinctId = posthog.getDistinctId()
   * ```
   *
   * @public
   *
   * @returns The current user's distinct ID
   */
  getDistinctId(): string {
    return super.getDistinctId()
  }

  /**
   * Sets person properties for feature flag evaluation.
   *
   * Sometimes, you might want to evaluate feature flags using properties that haven't been ingested yet, or were set incorrectly earlier.
   * You can do so by setting properties the flag depends on with this call. These are set for the entire session.
   * Successive calls are additive: all properties you set are combined together and sent for flag evaluation.
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // set person properties for flags
   * posthog.setPersonPropertiesForFlags({'property1': 'value', property2: 'value2'})
   * ```
   *
   * @public
   *
   * @param properties The person properties to set for flag evaluation
   */
  setPersonPropertiesForFlags(properties: Record<string, string>): void {
    super.setPersonPropertiesForFlags(properties)
  }

  /**
   * Resets person properties for feature flag evaluation.
   *
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // reset person properties for flags
   * posthog.resetPersonPropertiesForFlags()
   * ```
   *
   * @public
   */
  resetPersonPropertiesForFlags(): void {
    super.resetPersonPropertiesForFlags()
  }

  /**
   * Sets group properties for feature flag evaluation.
   *
   * These properties are automatically attached to the current group (set via posthog.group()).
   * When you change the group, these properties are reset.
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // set group properties for flags
   * posthog.setGroupPropertiesForFlags({'company': {'property1': 'value', property2: 'value2'}})
   * ```
   *
   * @public
   *
   * @param properties The group properties to set for flag evaluation
   */
  setGroupPropertiesForFlags(properties: Record<string, Record<string, string>>): void {
    super.setGroupPropertiesForFlags(properties)
  }

  /**
   * Resets group properties for feature flag evaluation.
   *
   * {@label Feature flags}
   *
   * @example
   * ```js
   * // reset group properties for flags
   * posthog.resetGroupPropertiesForFlags()
   * ```
   *
   * @public
   */
  resetGroupPropertiesForFlags(): void {
    super.resetGroupPropertiesForFlags()
  }

  /**
   * Captures a screen view event.
   *
   * @remarks
   * This function requires a name. You may also pass in an optional properties object.
   * Screen name is automatically registered for the session and will be included in subsequent events.
   *
   * {@label Capture}
   *
   * @example
   * ```js
   * // Basic screen capture
   * posthog.screen('dashboard')
   * ```
   *
   * @example
   * ```js
   * // Screen capture with properties
   * posthog.screen('dashboard', {
   *     background: 'blue',
   *     hero: 'superhog',
   * })
   * ```
   *
   * @public
   *
   * @param name - The name of the screen
   * @param properties - Optional properties to include with the screen event
   * @param options - Optional capture options
   */
  async screen(name: string, properties?: PostHogEventProperties, options?: PostHogCaptureOptions): Promise<void> {
    await this._initPromise
    // Screen name is good to know for all other subsequent events
    this.registerForSession({
      $screen_name: name,
    })

    return this.capture(
      '$screen',
      {
        ...properties,
        $screen_name: name,
      },
      options
    )
  }

  _isEnableSessionReplay(): boolean {
    return !this.isDisabled && (this._enableSessionReplay ?? false)
  }

  _resetSessionId(
    reactNativeSessionReplay: typeof OptionalReactNativeSessionReplay | undefined,
    sessionId: string
  ): void {
    // _resetSessionId is only called if reactNativeSessionReplay not undefined, but the linter wasn't happy
    if (reactNativeSessionReplay) {
      reactNativeSessionReplay.endSession()
      reactNativeSessionReplay.startSession(sessionId)
    }
  }

  getSessionId(): string {
    const sessionId = super.getSessionId()

    if (!this._isEnableSessionReplay()) {
      return sessionId
    }

    // only rotate if there is a new sessionId and it is different from the current one
    if (sessionId.length > 0 && this._currentSessionId && sessionId !== this._currentSessionId) {
      if (OptionalReactNativeSessionReplay) {
        try {
          this._resetSessionId(OptionalReactNativeSessionReplay, String(sessionId))
          this._logger.info(`sessionId rotated from ${this._currentSessionId} to ${sessionId}.`)
        } catch (e) {
          this._logger.error(`Failed to rotate sessionId: ${e}.`)
        }
      }
      this._currentSessionId = sessionId
    } else {
      this._logger.info(`sessionId not rotated, sessionId ${sessionId} and currentSessionId ${this._currentSessionId}.`)
    }

    return sessionId
  }

  resetSessionId(): void {
    super.resetSessionId()
    if (this._isEnableSessionReplay() && OptionalReactNativeSessionReplay) {
      try {
        OptionalReactNativeSessionReplay.endSession()
        this._logger.info(`Session replay ended.`)
      } catch (e) {
        this._logger.error(`Session replay failed to end: ${e}.`)
      }
    }
  }

  /**
   * Associates events with a specific user. Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify)
   *
   * {@label Identification}
   *
   * @example
   * ```js
   * // Basic identify
   * posthog.identify('distinctID', {
   *   email: 'user@posthog.com',
   *   name: 'My Name'
   * })
   * ```
   *
   * @example
   * ```js
   * // Using $set and $set_once
   * posthog.identify('distinctID', {
   *   $set: {
   *     email: 'user@posthog.com',
   *     name: 'My Name'
   *   },
   *   $set_once: {
   *     date_of_first_log_in: '2024-03-01'
   *   }
   * })
   * ```
   *
   * @public
   *
   * @param distinctId - A unique identifier for your user. Typically either their email or database ID.
   * @param properties - Optional dictionary with key:value pairs to set the person properties
   * @param options - Optional capture options
   */
  identify(distinctId?: string, properties?: PostHogEventProperties, options?: PostHogCaptureOptions): void {
    const previousDistinctId = this.getDistinctId()
    super.identify(distinctId, properties, options)

    if (this._isEnableSessionReplay() && OptionalReactNativeSessionReplay) {
      try {
        distinctId = distinctId || previousDistinctId
        const anonymousId = this.getAnonymousId()
        OptionalReactNativeSessionReplay.identify(String(distinctId), String(anonymousId))
        this._logger.info(`Session replay identified with distinctId ${distinctId} and anonymousId ${anonymousId}.`)
      } catch (e) {
        this._logger.error(`Session replay failed to identify: ${e}.`)
      }
    }
  }

  /**
   * Capture a caught exception manually
   *
   * {@label Error tracking}
   *
   * @public
   *
   * @example
   * ```js
   * // Capture a caught exception
   * try {
   *   // something that might throw
   * } catch (error) {
   *   posthog.captureException(error)
   * }
   * ```
   *
   * @example
   * ```js
   * // With additional properties
   * posthog.captureException(error, {
   *   customProperty: 'value',
   *   anotherProperty: ['I', 'can be a list'],
   *   ...
   * })
   * ```
   *
   * @param {Error} error The error to capture
   * @param {Object} [additionalProperties] Any additional properties to add to the error event
   * @returns {void}
   */
  captureException(error: Error | unknown, additionalProperties: PostHogEventProperties = {}): void {
    const syntheticException = new Error('Synthetic Error')
    this._errorTracking.captureException(error, additionalProperties, {
      mechanism: {
        handled: true,
        type: 'generic',
      },
      syntheticException,
    })
  }

  initReactNativeNavigation(options: PostHogAutocaptureOptions): boolean {
    return withReactNativeNavigation(this, options)
  }

  public async getSurveys(): Promise<SurveyResponse['surveys']> {
    if (this._disableSurveys === true) {
      this._logger.info('Loading surveys is disabled.')
      this.setPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys, null)
      return []
    }

    const surveys = this.getPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys)

    if (surveys && surveys.length > 0) {
      this._logger.info('Surveys fetched from storage: ', JSON.stringify(surveys))
      return surveys
    } else {
      this._logger.info('No surveys found in storage')
    }

    if (this._disableRemoteConfig === true) {
      const surveysFromApi = await super.getSurveysStateless()

      if (surveysFromApi && surveysFromApi.length > 0) {
        this.setPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys, surveysFromApi)
        return surveysFromApi
      }
    }

    return []
  }

  private async startSessionReplay(options?: PostHogOptions): Promise<void> {
    this._enableSessionReplay = options?.enableSessionReplay
    if (!this._isEnableSessionReplay()) {
      this._logger.info('Session replay is not enabled.')
      return
    }

    const defaultThrottleDelayMs = 1000

    const {
      maskAllTextInputs = true,
      maskAllImages = true,
      maskAllSandboxedViews = true,
      captureLog = true,
      captureNetworkTelemetry = true,
      iOSdebouncerDelayMs = defaultThrottleDelayMs,
      androidDebouncerDelayMs = defaultThrottleDelayMs,
    } = options?.sessionReplayConfig ?? {}

    let throttleDelayMs = options?.sessionReplayConfig?.throttleDelayMs ?? defaultThrottleDelayMs

    // if deprecated values are set, we use the higher one for back compatibility
    if (
      throttleDelayMs === defaultThrottleDelayMs &&
      (iOSdebouncerDelayMs !== defaultThrottleDelayMs || androidDebouncerDelayMs !== defaultThrottleDelayMs)
    ) {
      throttleDelayMs = Math.max(iOSdebouncerDelayMs, androidDebouncerDelayMs)
    }

    const sdkReplayConfig = {
      maskAllTextInputs,
      maskAllImages,
      maskAllSandboxedViews,
      captureLog,
      captureNetworkTelemetry,
      iOSdebouncerDelayMs,
      androidDebouncerDelayMs,
      throttleDelayMs,
    }

    this._logger.info(`Session replay SDK config: ${JSON.stringify(sdkReplayConfig)}`)

    // if Flags API has not returned yet, we will start session replay with default config.
    const sessionReplay = this.getPersistedProperty(PostHogPersistedProperty.SessionReplay) ?? {}
    const featureFlags = this.getKnownFeatureFlags() ?? {}
    const cachedFeatureFlags = (featureFlags as { [key: string]: FeatureFlagValue }) ?? {}
    const cachedSessionReplayConfig = (sessionReplay as { [key: string]: JsonType }) ?? {}

    this._logger.info('Session replay feature flags from flags cached config:', JSON.stringify(cachedFeatureFlags))

    this._logger.info(
      `Session replay session recording from flags cached config: ${JSON.stringify(cachedSessionReplayConfig)}`
    )

    let recordingActive = true
    const linkedFlag = cachedSessionReplayConfig['linkedFlag'] as
      | string
      | { [key: string]: JsonType }
      | null
      | undefined

    if (typeof linkedFlag === 'string') {
      const value = cachedFeatureFlags[linkedFlag]
      if (typeof value === 'boolean') {
        recordingActive = value
      } else if (typeof value === 'string') {
        // if its a multi-variant flag linked to "any"
        recordingActive = true
      } else {
        // disable recording if the flag does not exist/quota limited
        recordingActive = false
      }

      this._logger.info(`Session replay '${linkedFlag}' linked flag value: '${value}'`)
    } else if (linkedFlag && typeof linkedFlag === 'object') {
      const flag = linkedFlag['flag'] as string | undefined
      const variant = linkedFlag['variant'] as string | undefined
      if (flag && variant) {
        const value = cachedFeatureFlags[flag]
        recordingActive = value === variant
        this._logger.info(`Session replay '${flag}' linked flag variant '${variant}' and value '${value}'`)
      } else {
        // disable recording if the flag does not exist/quota limited
        this._logger.info(`Session replay '${flag}' linked flag variant: '${variant}' does not exist/quota limited.`)
        recordingActive = false
      }
    } else {
      this._logger.info(`Session replay has no cached linkedFlag.`)
    }

    if (recordingActive) {
      if (OptionalReactNativeSessionReplay) {
        const sessionId = this.getSessionId()

        if (sessionId.length === 0) {
          this._logger.warn(`Session replay enabled but no sessionId found.`)
          return
        }

        const sdkOptions = {
          apiKey: this.apiKey,
          host: this.host,
          debug: this.isDebug,
          distinctId: this.getDistinctId(),
          anonymousId: this.getAnonymousId(),
          sdkVersion: this.getLibraryVersion(),
          flushAt: this.flushAt,
        }

        this._logger.info(`Session replay sdk options: ${JSON.stringify(sdkOptions)}`)

        try {
          if (!(await OptionalReactNativeSessionReplay.isEnabled())) {
            await OptionalReactNativeSessionReplay.start(
              String(sessionId),
              sdkOptions,
              sdkReplayConfig,
              cachedSessionReplayConfig
            )
            this._logger.info(`Session replay started with sessionId ${sessionId}.`)
          } else {
            // if somehow the SDK is already enabled with a different sessionId, we reset it
            this._resetSessionId(OptionalReactNativeSessionReplay, String(sessionId))
            this._logger.info(`Session replay already started with sessionId ${sessionId}.`)
          }
          this._currentSessionId = sessionId
        } catch (e) {
          this._logger.error(`Session replay failed to start: ${e}.`)
        }
      } else {
        this._logger.warn('Session replay enabled but not installed.')
      }
    } else {
      this._logger.info('Session replay disabled.')
    }
  }

  private async captureAppLifecycleEvents(): Promise<void> {
    const appBuild = this._appProperties.$app_build
    const appVersion = this._appProperties.$app_version

    const isMemoryPersistence = this._persistence === 'memory'

    const properties: PostHogEventProperties = {}

    if (!isMemoryPersistence) {
      const prevAppBuild = this.getPersistedProperty(PostHogPersistedProperty.InstalledAppBuild) as string | undefined
      const prevAppVersion = this.getPersistedProperty(PostHogPersistedProperty.InstalledAppVersion) as
        | string
        | undefined

      if (!appBuild || !appVersion) {
        this._logger.warn(
          'PostHog could not track installation/update/open, as the build and version were not set. ' +
            'This can happen if some dependencies are not installed correctly, or if you have provided' +
            'customAppProperties but not included $app_build or $app_version.'
        )
      }
      if (appBuild) {
        if (!prevAppBuild) {
          // new app install
          this.capture('Application Installed', properties)
        } else if (prevAppBuild !== appBuild) {
          // $app_version and $app_build are already added in the common event properties
          // app updated
          this.capture('Application Updated', {
            ...maybeAdd('previous_version', prevAppVersion),
            ...maybeAdd('previous_build', prevAppBuild),
            ...properties,
          })
        }
      }
    } else {
      this._logger.warn(
        'PostHog was initialised with persistence set to "memory", capturing native app events (Application Installed and Application Updated) is not supported.'
      )
    }

    const initialUrl = (await Linking.getInitialURL()) ?? undefined

    this.capture('Application Opened', {
      ...properties,
      ...maybeAdd('url', initialUrl),
    })

    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        this.capture('Application Became Active')
      } else if (state === 'background') {
        this.capture('Application Backgrounded')
      }
    })
  }

  private async persistAppVersion(): Promise<void> {
    const appBuild = this._appProperties.$app_build
    const appVersion = this._appProperties.$app_version
    this.setPersistedProperty(PostHogPersistedProperty.InstalledAppBuild, appBuild)
    this.setPersistedProperty(PostHogPersistedProperty.InstalledAppVersion, appVersion)
  }
}
