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
} from '../../posthog-core/src'
import { getLegacyValues } from './legacy'
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

export type PostHogOptions = PostHogCoreOptions & {
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
}

export class PostHog extends PostHogCore {
  private _persistence: PostHogOptions['persistence']
  private _storage: PostHogRNStorage
  private _appProperties: PostHogCustomAppProperties = {}
  private _currentSessionId?: string | undefined
  private _enableSessionReplay?: boolean
  private _disableSurveys: boolean
  private _disableRemoteConfig: boolean

  constructor(apiKey: string, options?: PostHogOptions) {
    super(apiKey, options)
    this._isInitialized = false
    this._persistence = options?.persistence ?? 'file'
    this._disableSurveys = options?.disableSurveys ?? false
    this._disableRemoteConfig = options?.disableRemoteConfig ?? false

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
      storagePromise.then(() => {
        // This code is for migrating from V1 to V2 and tries its best to keep the existing anon/distinctIds
        // It only applies for async storage
        if (!this._storage.getItem(PostHogPersistedProperty.AnonymousId)) {
          void getLegacyValues().then((legacyValues) => {
            if (legacyValues?.distinctId) {
              this._storage?.setItem(PostHogPersistedProperty.DistinctId, legacyValues.distinctId)
              this._storage?.setItem(PostHogPersistedProperty.AnonymousId, legacyValues.anonymousId)
            }
          })
        }
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
        this.logMsgIfDebug(() => console.info('PostHog Debug', `Remote config is disabled.`))
        if (options?.preloadFeatureFlags !== false) {
          this.logMsgIfDebug(() => console.info('PostHog Debug', `Feature flags will be preloaded from Flags API.`))
          this.reloadFeatureFlags()
        } else {
          this.logMsgIfDebug(() => console.info('PostHog Debug', `preloadFeatureFlags is disabled.`))
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

  // NOTE: This is purely a helper method for testing purposes or those who wish to be certain the SDK is fully initialised
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

  // Custom methods
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
          this._resetSessionId(OptionalReactNativeSessionReplay, sessionId)
          this.logMsgIfDebug(() =>
            console.info('PostHog Debug', `sessionId rotated from ${this._currentSessionId} to ${sessionId}.`)
          )
        } catch (e) {
          this.logMsgIfDebug(() => console.error('PostHog Debug', `Failed to rotate sessionId: ${e}.`))
        }
      }
      this._currentSessionId = sessionId
    } else {
      this.logMsgIfDebug(() =>
        console.log(
          'PostHog Debug',
          `sessionId not rotated, sessionId ${sessionId} and currentSessionId ${this._currentSessionId}.`
        )
      )
    }

    return sessionId
  }

  resetSessionId(): void {
    super.resetSessionId()
    if (this._isEnableSessionReplay() && OptionalReactNativeSessionReplay) {
      try {
        OptionalReactNativeSessionReplay.endSession()
        this.logMsgIfDebug(() => console.info('PostHog Debug', `Session replay ended.`))
      } catch (e) {
        this.logMsgIfDebug(() => console.error('PostHog Debug', `Session replay failed to end: ${e}.`))
      }
    }
  }

  identify(distinctId?: string, properties?: PostHogEventProperties, options?: PostHogCaptureOptions): void {
    const previousDistinctId = this.getDistinctId()
    super.identify(distinctId, properties, options)

    if (this._isEnableSessionReplay() && OptionalReactNativeSessionReplay) {
      try {
        distinctId = distinctId || previousDistinctId
        OptionalReactNativeSessionReplay.identify(distinctId, this.getAnonymousId())
        this.logMsgIfDebug(() =>
          console.info('PostHog Debug', `Session replay identified with distinctId ${distinctId}.`)
        )
      } catch (e) {
        this.logMsgIfDebug(() => console.error('PostHog Debug', `Session replay failed to identify: ${e}.`))
      }
    }
  }

  initReactNativeNavigation(options: PostHogAutocaptureOptions): boolean {
    return withReactNativeNavigation(this, options)
  }

  public async getSurveys(): Promise<SurveyResponse['surveys']> {
    if (this._disableSurveys === true) {
      this.logMsgIfDebug(() => console.log('PostHog Debug', 'Loading surveys is disabled.'))
      this.setPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys, null)
      return []
    }

    const surveys = this.getPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys)

    if (surveys && surveys.length > 0) {
      this.logMsgIfDebug(() => console.log('PostHog Debug', 'Surveys fetched from storage: ', JSON.stringify(surveys)))
      return surveys
    } else {
      this.logMsgIfDebug(() => console.log('PostHog Debug', 'No surveys found in storage'))
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
      this.logMsgIfDebug(() => console.info('PostHog Debug', 'Session replay is not enabled.'))
      return
    }

    const {
      maskAllTextInputs = true,
      maskAllImages = true,
      maskAllSandboxedViews = true,
      captureLog = true,
      captureNetworkTelemetry = true,
      iOSdebouncerDelayMs = 1000,
      androidDebouncerDelayMs = 1000,
    } = options?.sessionReplayConfig ?? {}

    const sdkReplayConfig = {
      maskAllTextInputs,
      maskAllImages,
      maskAllSandboxedViews,
      captureLog,
      captureNetworkTelemetry,
      iOSdebouncerDelayMs,
      androidDebouncerDelayMs,
    }

    this.logMsgIfDebug(() =>
      console.log('PostHog Debug', `Session replay SDK config: ${JSON.stringify(sdkReplayConfig)}`)
    )

    // if Flags API has not returned yet, we will start session replay with default config.
    const sessionReplay = this.getPersistedProperty(PostHogPersistedProperty.SessionReplay) ?? {}
    const featureFlags = this.getKnownFeatureFlags() ?? {}
    const cachedFeatureFlags = (featureFlags as { [key: string]: FeatureFlagValue }) ?? {}
    const cachedSessionReplayConfig = (sessionReplay as { [key: string]: JsonType }) ?? {}

    this.logMsgIfDebug(() =>
      console.log(
        'PostHog Debug',
        `Session replay feature flags from flags cached config: ${JSON.stringify(cachedFeatureFlags)}`
      )
    )

    this.logMsgIfDebug(() =>
      console.log(
        'PostHog Debug',
        `Session replay session recording from flags cached config: ${JSON.stringify(cachedSessionReplayConfig)}`
      )
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

      this.logMsgIfDebug(() =>
        console.log('PostHog Debug', `Session replay '${linkedFlag}' linked flag value: '${value}'`)
      )
    } else if (linkedFlag && typeof linkedFlag === 'object') {
      const flag = linkedFlag['flag'] as string | undefined
      const variant = linkedFlag['variant'] as string | undefined
      if (flag && variant) {
        const value = cachedFeatureFlags[flag]
        recordingActive = value === variant
        this.logMsgIfDebug(() =>
          console.log('PostHog Debug', `Session replay '${flag}' linked flag variant '${variant}' and value '${value}'`)
        )
      } else {
        // disable recording if the flag does not exist/quota limited
        this.logMsgIfDebug(() =>
          console.log(
            'PostHog Debug',
            `Session replay '${flag}' linked flag variant: '${variant}' does not exist/quota limited.`
          )
        )
        recordingActive = false
      }
    } else {
      this.logMsgIfDebug(() => console.log('PostHog Debug', `Session replay has no cached linkedFlag.`))
    }

    if (recordingActive) {
      if (OptionalReactNativeSessionReplay) {
        const sessionId = this.getSessionId()

        if (sessionId.length === 0) {
          this.logMsgIfDebug(() => console.warn('PostHog Debug', 'Session replay enabled but no sessionId found.'))
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

        this.logMsgIfDebug(() =>
          console.log('PostHog Debug', `Session replay sdk options: ${JSON.stringify(sdkOptions)}`)
        )

        try {
          if (!(await OptionalReactNativeSessionReplay.isEnabled())) {
            await OptionalReactNativeSessionReplay.start(
              sessionId,
              sdkOptions,
              sdkReplayConfig,
              cachedSessionReplayConfig
            )
            this.logMsgIfDebug(() =>
              console.info('PostHog Debug', `Session replay started with sessionId ${sessionId}.`)
            )
          } else {
            // if somehow the SDK is already enabled with a different sessionId, we reset it
            this._resetSessionId(OptionalReactNativeSessionReplay, sessionId)
            this.logMsgIfDebug(() =>
              console.log('PostHog Debug', `Session replay already started with sessionId ${sessionId}.`)
            )
          }
          this._currentSessionId = sessionId
        } catch (e) {
          this.logMsgIfDebug(() => console.error('PostHog Debug', `Session replay failed to start: ${e}.`))
        }
      } else {
        this.logMsgIfDebug(() => console.warn('PostHog Debug', 'Session replay enabled but not installed.'))
      }
    } else {
      this.logMsgIfDebug(() => console.info('PostHog Debug', 'Session replay disabled.'))
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
        this.logMsgIfDebug(() =>
          console.warn(
            'PostHog could not track installation/update/open, as the build and version were not set. ' +
              'This can happen if some dependencies are not installed correctly, or if you have provided' +
              'customAppProperties but not included $app_build or $app_version.'
          )
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
      this.logMsgIfDebug(() =>
        console.warn(
          'PostHog was initialised with persistence set to "memory", capturing native app events (Application Installed and Application Updated) is not supported.'
        )
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
