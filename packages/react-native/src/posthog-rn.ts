import { AppState, type AppStateStatus, Dimensions, Linking, Platform } from 'react-native'

import {
  CaptureLogOptions,
  CaptureLogger,
  JsonType,
  PostHogCaptureOptions,
  PostHogCore,
  PostHogCoreOptions,
  PostHogEventProperties,
  PostHogFetchOptions,
  PostHogFetchResponse,
  PostHogLogs,
  PostHogLogsConfig,
  PostHogPersistedProperty,
  PostHogRemoteConfig,
  Survey,
  SurveyResponse,
  allSettled,
  logFlushError,
  maybeAdd,
  patchFetchForTracingHeaders,
  safeSetTimeout,
  FeatureFlagValue,
  ErrorTracking as CoreErrorTracking,
} from '@posthog/core'
import {
  PostHogRNStorage,
  createEventsStorage,
  createLogsStorage,
  createEventsMemoryStorage,
  createLogsMemoryStorage,
} from './storage'
import { resolveLogsConfig } from './logs-defaults'
import { version } from './version'
import { buildOptimisticAsyncStorage, getAppProperties } from './native-deps'
import {
  PostHogAutocaptureOptions,
  PostHogCustomAppProperties,
  PostHogCustomStorage,
  PostHogSessionReplayConfig,
} from './types'
import { getRemoteConfigBool, getRemoteConfigNumber, isHermes, isValidSampleRate } from './utils'
import { withReactNativeNavigation } from './frameworks/wix-navigation'
import { OptionalReactNativePlugin } from './optional/OptionalPlugin'
import { ErrorTracking, ErrorTrackingOptions } from './error-tracking'

export { PostHogPersistedProperty }

/**
 * Collapses RN's broader AppState status set into the OTLP `app.state`
 * enum (foreground|background). 'inactive' (iOS transition) and 'extension'
 * are treated as foreground — the app is still running JS, just not the
 * primary scene. 'unknown' returns undefined so the attribute is omitted
 * rather than guessed.
 */
function mapAppStateForLogs(state: AppStateStatus | undefined): 'foreground' | 'background' | undefined {
  if (state === 'background') {
    return 'background'
  }
  if (!state || state === 'unknown') {
    return undefined
  }
  return 'foreground'
}

export interface PostHogOptions extends PostHogCoreOptions {
  /**
   * Allows you to provide the storage type.
   * 'file' will try to load the best available storage, the provided 'customStorage', 'customAsyncStorage' or in-memory storage.
   *
   * @default 'file'
   */
  persistence?: 'memory' | 'file'
  /** Allows you to provide your own implementation of the common information about your App or a function to modify the default App properties generated */
  customAppProperties?:
    | PostHogCustomAppProperties
    | ((properties: PostHogCustomAppProperties) => PostHogCustomAppProperties)
  /**
   * Allows you to provide a custom asynchronous storage such as async-storage, expo-file-system or a synchronous storage such as mmkv.
   * If not provided, PostHog will attempt to use the best available storage via optional peer dependencies (async-storage, expo-file-system).
   * If `persistence` is set to 'memory', this option will be ignored.
   */
  customStorage?: PostHogCustomStorage

  /**
   * Captures app lifecycle events such as Application Installed, Application Updated, Application Opened, Application Became Active and Application Backgrounded.
   * Application Installed and Application Updated events are not supported with persistence set to 'memory'.
   *
   * @default true
   */
  captureAppLifecycleEvents?: boolean

  /**
   * Enable Recording of Session Replays for Android and iOS
   * Requires Record user sessions to be enabled in the PostHog Project Settings
   *
   * @default false
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
   *
   * @default false
   */
  enablePersistSessionIdAcrossRestart?: boolean

  /**
   * Error Tracking Configuration
   */
  errorTracking?: ErrorTrackingOptions

  /**
   * Automatically include common device and app properties in feature flag evaluation.
   *
   * When enabled, the following properties are sent with every /flags request:
   * - $app_version: App version
   * - $app_build: App build number
   * - $app_namespace: App bundle identifier / namespace
   * - $os_name: Operating system name
   * - $os_version: Operating system version
   * - $device_type: Device type (Mobile, Desktop)
   * - $lib: Name of the SDK library
   * - $lib_version: Version of the SDK library
   *
   * This ensures feature flags that rely on these properties work correctly
   * without waiting for server-side processing of identify() calls.
   *
   * @default true
   */
  setDefaultPersonProperties?: boolean

  /**
   * Logs feature configuration. Enables structured log capture via
   * `posthog.captureLog(...)` or `posthog.logger.info(...)`. Records ship to
   * PostHog's logs product (`/i/v1/logs`) in OTLP format, batched on a timer,
   * AppState change, buffer fill, or manual `flushLogs()`.
   *
   * Capture is **unconditional** — calling the API ships records as long as
   * the SDK is initialized and the user hasn't opted out. The only blockers
   * are `optedOut`, missing/empty `body`, and missing API key.
   *
   * All fields below are optional; per-SDK defaults apply (mobile defaults
   * are tuned for cellular bandwidth and battery, ~50 logs/sec ceiling).
   *
   * @example Minimal — just service tagging, defaults for everything else
   * ```ts
   * new PostHog(key, {
   *   logs: { serviceName: 'my-app', environment: 'production' }
   * })
   * ```
   *
   * @example Tune for higher-volume logging
   * ```ts
   * new PostHog(key, {
   *   logs: {
   *     serviceName: 'my-app',
   *     rateCap: { maxLogs: 5000, windowMs: 60000 },
   *     maxBufferSize: 500,
   *     beforeSend: (r) => r.body.includes('secret') ? null : r,
   *   }
   * })
   * ```
   */
  logs?: PostHogLogsConfig

  /**
   * Overrides the language used when rendering translated survey copy.
   * When unset, the SDK falls back to the persisted person property `language`
   * and then the device locale.
   */
  overrideDisplayLanguage?: string | null
}

export class PostHog extends PostHogCore {
  private _persistence: PostHogOptions['persistence']
  private _eventsStorage: PostHogRNStorage
  private _logsStorage: PostHogRNStorage
  private _appProperties: PostHogCustomAppProperties = {}
  private _currentSessionId?: string | undefined
  private _enableSessionReplay?: boolean
  private _sessionReplayNativeInitialized: boolean = false
  private _nativeErrorTrackingInitialized: boolean = false
  // Last applied recording state; the native bridge is only crossed on a change.
  private _sessionReplayRecordingActive?: boolean
  // Serializes re-arm evaluations so concurrent flags reloads don't interleave.
  private _sessionReplayEvalChain: Promise<void> = Promise.resolve()
  private _sessionReplayOptions?: PostHogOptions
  private _disableSurveys: boolean
  private _disableRemoteConfig: boolean
  private _errorTracking: ErrorTracking
  private _logs: PostHogLogs
  // Resolved logs config — kept around so lifecycle handlers (AppState
  // background, _shutdown) can read the configured flush-time budgets without
  // reaching back into the user's options object.
  private _resolvedLogsConfig: ReturnType<typeof resolveLogsConfig>
  // Cached, foreground/background view of the app's lifecycle. Read on the
  // log-capture hot path (per record) so we tag every log with whether it
  // happened in foreground or background. Updated by the AppState listener
  // and seeded from `AppState.currentState` at construction.
  private _currentAppState?: 'foreground' | 'background'
  private _surveysReadyPromise: Promise<void> | null = null
  private _surveysReady: boolean = false
  private _setDefaultPersonProperties: boolean
  private _overrideDisplayLanguage: string | null

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
    const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : ''
    if (!normalizedApiKey) {
      console.error("You must pass your PostHog project's api key. The client will be disabled.")
    }

    super(normalizedApiKey, options)
    this._isInitialized = false
    this._persistence = options?.persistence ?? 'file'
    this._disableSurveys = options?.disableSurveys ?? false
    this._disableRemoteConfig = options?.disableRemoteConfig ?? false
    this._errorTracking = new ErrorTracking(this, options?.errorTracking, this._logger)
    this._setDefaultPersonProperties = options?.setDefaultPersonProperties ?? true
    this._overrideDisplayLanguage = options?.overrideDisplayLanguage?.trim() || null

    // Either build the app properties from the existing ones
    this._appProperties =
      typeof options?.customAppProperties === 'function'
        ? options.customAppProperties(getAppProperties())
        : options?.customAppProperties || getAppProperties()

    // Resolve storage and construct the logs module BEFORE registering the
    // AppState listener — the listener body references `this._logs` and
    // `this._eventsStorage`, and while AppState.addEventListener('change')
    // only fires on changes (not at registration), the dependency direction
    // should be explicit: dependencies first, callbacks that use them second.
    let storagePromise: Promise<void> | undefined

    let theStorage: PostHogCustomStorage | undefined
    if (this._persistence === 'file') {
      theStorage = options?.customStorage ?? buildOptimisticAsyncStorage()
    }

    if (theStorage) {
      this._eventsStorage = createEventsStorage(theStorage)
      this._logsStorage = createLogsStorage(theStorage)
      // `allSettled` so one pipeline's preload failure doesn't block the other — the failing side
      // degrades to memory-only via PostHogRNStorage.persist()'s internal catch.
      const preloads: Array<['events' | 'logs', Promise<void>]> = []
      if (this._eventsStorage.preloadPromise) {
        preloads.push(['events', this._eventsStorage.preloadPromise])
      }
      if (this._logsStorage.preloadPromise) {
        preloads.push(['logs', this._logsStorage.preloadPromise])
      }
      if (preloads.length > 0) {
        storagePromise = allSettled(preloads.map(([, p]) => p)).then((results) => {
          results.forEach((r, i) => {
            if (r.status === 'rejected') {
              this._logger.error(`PostHog ${preloads[i][0]} storage preload failed:`, r.reason)
            }
          })
        })
      }
    } else {
      this._eventsStorage = createEventsMemoryStorage()
      this._logsStorage = createLogsMemoryStorage()
    }

    // Seed from sync `AppState.currentState` so the very first capture (which
    // can happen before any 'change' event fires) is already tagged. Maps
    // RN's broader status set into the OTLP `app.state` enum's
    // foreground/background dichotomy.
    this._currentAppState = mapAppStateForLogs(AppState.currentState)

    this._resolvedLogsConfig = resolveLogsConfig(options?.logs)
    this._logs = new PostHogLogs(
      this,
      this._resolvedLogsConfig,
      this._logger,
      () => {
        // Pulled at capture time so each tag reflects state at the moment
        // the log was fired, not at flush.
        const flags = this.getFeatureFlags()
        const flagKeys = flags ? Object.keys(flags) : undefined
        return {
          distinctId: this.getDistinctId() || undefined,
          sessionId: this.getSessionId() || undefined,
          screenName: (this.sessionProps?.$screen_name as string | undefined) || undefined,
          appState: this._currentAppState,
          activeFeatureFlags: flagKeys && flagKeys.length > 0 ? flagKeys : undefined,
        }
      },
      (fn) => this.wrap(fn),
      // Block between batches on the logs-storage disk write so a crash can't
      // replay an already-sent batch. Events do the equivalent via
      // `flushStorage()` (events-storage side). Mirror per-pipeline so one
      // pipeline's slow disk doesn't stall the other.
      () => this._logsStorage.waitForPersist()
    )

    // NOTE: this listener is registered for the lifetime of the PostHog
    // instance and is never explicitly removed. RN apps typically construct
    // a single long-lived PostHog and keep it until process exit, so a leak
    // doesn't matter in practice; just be aware that constructing many
    // instances (e.g. in tests without an explicit teardown) would
    // accumulate listeners.
    AppState.addEventListener('change', (state) => {
      // ignore unknown state (usually initial state, the app might not be ready yet)
      if (state === 'unknown') {
        return
      }

      // Update before kicking off the flush — captures that race the flush
      // (e.g. fired in a `componentWillUnmount` triggered by backgrounding)
      // should already see the new state.
      const mapped = mapAppStateForLogs(state)
      if (mapped) {
        this._currentAppState = mapped
      }

      // Flush on every transition, including foreground→active. Foreground
      // flush is technically redundant (the timer would catch up shortly),
      // but it's cheap and keeps the lifecycle handler symmetric — no
      // special-casing of which transitions should drain.
      void this.flush().catch(async (err) => {
        await logFlushError(err)
      })
      // Flush buffered logs alongside events — OS may suspend or terminate the
      // process next, and anything left in the queue won't get a second chance
      // until the app is next foregrounded. On background, race the flush
      // against `backgroundFlushBudgetMs` so a slow network can't run past
      // the OS-imposed background window (~30s on iOS). Foreground/active
      // transitions don't need a budget — the app is staying alive.
      const isBackgrounding = mapped === 'background'
      const logsFlushPromise = isBackgrounding
        ? this._logs.flushWithTimeout(this._resolvedLogsConfig.backgroundFlushBudgetMs)
        : this._logs.flush()
      void logsFlushPromise.catch(async (err) => {
        await logFlushError(err)
      })
      // Persist pending writes before the OS may suspend the process.
      void this._eventsStorage.waitForPersist()
      void this._logsStorage.waitForPersist()

      if (state === 'active') {
        this.getSessionId()
      }
    })

    const initAfterStorage = (): void => {
      // reset session id on app restart
      const enablePersistSessionIdAcrossRestart = options?.enablePersistSessionIdAcrossRestart
      if (!enablePersistSessionIdAcrossRestart) {
        this.setPersistedProperty(PostHogPersistedProperty.SessionId, null)
        this.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, null)
        this.setPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp, null)
      }

      this.setupBootstrap(options)

      // Seed device_id from the anonymous id at init time so existing installs
      // get a stable device-level identifier; once set, it survives identify()
      // and reset() independently of anonymous_id.
      if (!this.getPersistedProperty(PostHogPersistedProperty.DeviceId)) {
        const anonId = this.getAnonymousId()
        if (anonId) {
          this.setPersistedProperty(PostHogPersistedProperty.DeviceId, anonId)
        }
      }

      // Set default person properties for flags if enabled
      if (this._setDefaultPersonProperties) {
        this._setDefaultPersonPropertiesForFlags(false)
      }

      this._isInitialized = true

      if (this.isDisabled) {
        return
      }

      // Preload error tracking state from cached remote config.
      // This gates error tracking autocapture before the fresh remote config is fetched.
      const cachedRemoteConfig = this.getPersistedProperty<Omit<PostHogRemoteConfig, 'surveys'>>(
        PostHogPersistedProperty.RemoteConfig
      )
      if (cachedRemoteConfig) {
        this._errorTracking.onRemoteConfig(cachedRemoteConfig.errorTracking)
      }

      if (this._disableRemoteConfig === false) {
        this.reloadRemoteConfigAsync()
          .then((response) => {
            if (response) {
              this._handleSurveysFromRemoteConfig(response)
            }
          })
          .catch((error) => {
            this._logger.error('Error loading remote config:', error)
          })
          .finally(() => {
            this._notifySurveysReady()
          })
      } else {
        this._logger.info('Remote config is disabled.')

        if (options?.preloadFeatureFlags !== false) {
          this._logger.info('Feature flags will be preloaded from Flags API.')
          // Preload flags (and parse surveys as well since we are calling with config=true already)
          this._flagsAsyncWithSurveys()
            .catch((error) => {
              this._logger.error('Error loading flags with surveys:', error)
            })
            .finally(() => {
              this._notifySurveysReady()
            })
        } else {
          this._logger.info('preloadFeatureFlags is disabled, loading surveys from API.')
          // Load surveys directly from API since both remote config and preloading feature flags are disabled
          // Note: if flags are not loaded/cached then surveys will not be displayed until reloadFeatureFlags() is called, since surveys depend on internal flags
          this._loadSurveysFromAPI()
            .catch((error) => {
              this._logger.error('Error loading surveys from API:', error)
            })
            .finally(() => {
              this._notifySurveysReady()
            })
        }
      }

      // captureAppLifecycleEvents defaults to true; only skip if explicitly set to false
      if (options?.captureAppLifecycleEvents !== false) {
        void this.captureAppLifecycleEvents()
      }

      void this.persistAppVersion()

      void this.startSessionReplay(options, cachedRemoteConfig ?? undefined)

      // Re-evaluate session replay on every flags load/reload so the linked flag
      // gates recording without an app restart.
      if (options?.enableSessionReplay) {
        this.onFeatureFlags(() => {
          void this._evaluateAndStartSessionReplay()
        })
      }

      if (options?.addTracingHeaders && options.addTracingHeaders.length > 0) {
        patchFetchForTracingHeaders(this, options.addTracingHeaders)
      }
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

  /**
   * Called when remote config has been loaded (from either the remote config endpoint or the flags endpoint).
   * Gates error tracking autocapture based on the remote config response.
   *
   * Session replay config (consoleLogRecordingEnabled, sampleRate, capturePerformance.network_timing) is already
   * cached via PostHogPersistedProperty.RemoteConfig and applied at startup in startSessionReplay().
   *
   * @internal
   */
  protected onRemoteConfig(response: PostHogRemoteConfig): void {
    this._errorTracking.onRemoteConfig(response.errorTracking)
  }

  /**
   * Resolves the storage instance for a given persisted-property key.
   * `LogsQueue` routes to `_logsStorage` (dedicated `.posthog-rn-logs.json`
   * file); every other key routes to `_eventsStorage`. Single source of
   * truth for routing — extending to new logs-scoped keys is a one-line
   * edit here.
   */
  private _storageForKey(key: PostHogPersistedProperty): PostHogRNStorage {
    return key === PostHogPersistedProperty.LogsQueue ? this._logsStorage : this._eventsStorage
  }

  getPersistedProperty<T>(key: PostHogPersistedProperty): T | undefined {
    return this._storageForKey(key).getItem(key) as T | undefined
  }

  setPersistedProperty<T>(key: PostHogPersistedProperty, value: T | null): void {
    const storage = this._storageForKey(key)
    return value !== null ? storage.setItem(key, value) : storage.removeItem(key)
  }

  /**
   * Waits for any pending storage operations to complete.
   * This ensures data has been safely written to async storage before
   * considering events as sent, preventing duplicate events on app crash/restart.
   */
  protected async flushStorage(): Promise<void> {
    await this._eventsStorage.waitForPersist()
  }

  /**
   * Drain both pipelines on shutdown. Run in parallel so the logs final
   * flush + timer teardown doesn't serialize behind events (and vice-versa).
   * `_logs.shutdown()` swallows its own errors — a transient logs failure
   * must not break events shutdown.
   *
   * Logs use the smaller of `terminationFlushBudgetMs` and the caller's
   * `shutdownTimeoutMs` so a final flush can never run past the caller's
   * shutdown SLA, while still respecting the configured logs-specific
   * termination budget when it's tighter.
   *
   * After the flushes, drain any debounced storage writes that weren't already
   * persisted via the queue-advance path — `setPersistedProperty` calls for
   * distinctId, sessionId, deviceId, feature flag overrides, etc. only arm a
   * debounced write. The drain runs in `finally` so a timed-out flush still
   * persists them, and its await is bounded by the time left in the shutdown
   * SLA so a hung storage backend can't run past it.
   */
  async _shutdown(shutdownTimeoutMs: number = 30000): Promise<void> {
    this._errorTracking.clearExceptionSteps()
    const start = Date.now()
    const logsBudgetMs = Math.min(shutdownTimeoutMs, this._resolvedLogsConfig.terminationFlushBudgetMs)
    try {
      await Promise.all([this._logs.shutdown(logsBudgetMs), super._shutdown(shutdownTimeoutMs)])
    } finally {
      // Sync drain runs inside waitForPersist before the race below; the race
      // only bounds the await for in-flight async writes.
      const remainingMs = Math.max(0, shutdownTimeoutMs - (Date.now() - start))
      const drain = Promise.all([this._eventsStorage.waitForPersist(), this._logsStorage.waitForPersist()])
      await Promise.race([drain, new Promise<void>((resolve) => safeSetTimeout(resolve, remainingMs))])
    }
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

  getSurveyDisplayLanguageOverride(): string | null {
    return this._overrideDisplayLanguage
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
   * By default (when `propertiesToKeep` is not provided), the app lifecycle properties
   * (`InstalledAppBuild` and `InstalledAppVersion`) are automatically preserved to prevent
   * duplicate "Application Installed" events on the next app launch.
   *
   * If you pass `propertiesToKeep` explicitly, only the properties you specify will be preserved.
   * To keep the default app lifecycle behavior, include `PostHogPersistedProperty.InstalledAppBuild`
   * and `PostHogPersistedProperty.InstalledAppVersion` in your array.
   *
   * Note: The event queue (`PostHogPersistedProperty.Queue`) and logs queue
   * (`PostHogPersistedProperty.LogsQueue`) are always preserved regardless of
   * what is passed in `propertiesToKeep`, to ensure in-flight data is not lost.
   *
   * The project-level remote config (`PostHogPersistedProperty.RemoteConfig`,
   * `PostHogPersistedProperty.SessionReplay`, `PostHogPersistedProperty.Surveys`) is also
   * always preserved — it is not user data — so session replay and surveys keep working
   * after an identity change. The user-specific survey state (`SurveysSeen`,
   * `SurveyLastSeenDate`) is still cleared.
   *
   * {@label Identification}
   *
   * @example
   * ```js
   * // reset after logout (preserves app lifecycle properties by default)
   * posthog.reset()
   * ```
   *
   * @example
   * ```js
   * // reset but keep feature flag overrides and app lifecycle properties
   * posthog.reset([
   *   PostHogPersistedProperty.OverrideFeatureFlags,
   *   PostHogPersistedProperty.InstalledAppBuild,
   *   PostHogPersistedProperty.InstalledAppVersion,
   * ])
   * ```
   *
   * @param propertiesToKeep - Optional array of persisted properties to preserve during reset.
   *   When not provided, app lifecycle and device bucketing properties are automatically preserved.
   *   When provided, only the specified properties are preserved.
   *   The event queue and logs queue are always preserved regardless.
   *
   * @public
   */
  reset(propertiesToKeep?: PostHogPersistedProperty[]): void {
    // When propertiesToKeep is not explicitly provided, automatically preserve app lifecycle
    // properties and device_id to prevent duplicate "Application Installed" events and
    // to maintain stable feature flag bucketing across identity changes.
    const effectivePropertiesToKeep = propertiesToKeep ?? [
      PostHogPersistedProperty.InstalledAppBuild,
      PostHogPersistedProperty.InstalledAppVersion,
      PostHogPersistedProperty.DeviceId,
    ]

    // RemoteConfig, SessionReplay, and Surveys are project-level config, not user data:
    // always preserve them so replay can re-arm against the new user's flags. The
    // user-specific survey state (SurveysSeen, SurveyLastSeenDate) is still cleared.
    super.reset([
      PostHogPersistedProperty.RemoteConfig,
      PostHogPersistedProperty.SessionReplay,
      PostHogPersistedProperty.Surveys,
      ...effectivePropertiesToKeep,
    ])

    if (this._setDefaultPersonProperties) {
      // Reset reloads flags asyncrhonously, but doesn't wait for it.
      // As a result, we can synchronously set the default person properties without
      // reloading, and allow the super.reset() call to reload the flags.
      this._setDefaultPersonPropertiesForFlags(false)
    }

    // Logout must be durable so a crash in the debounce window can't resurface the previous user.
    void this._eventsStorage.waitForPersist()
  }

  /**
   * Helper to extract and set default person properties from app properties
   *
   * @private
   *
   * @param reloadFeatureFlags Whether to reload feature flags after setting the properties. Defaults to true.
   */
  private _setDefaultPersonPropertiesForFlags(reloadFeatureFlags = true): void {
    const defaultProps: Record<string, JsonType> = {}
    const relevantKeys = [
      '$app_version',
      '$app_build',
      '$app_namespace',
      '$os_name',
      '$os_version',
      '$device_type',
    ] as const

    relevantKeys.forEach((key) => {
      const value = this._appProperties[key]
      if (value !== null && value !== undefined) {
        defaultProps[key] = value
      }
    })

    const commonProps = this.getCommonEventProperties()
    if (commonProps.$lib) {
      defaultProps.$lib = commonProps.$lib
    }
    if (commonProps.$lib_version) {
      defaultProps.$lib_version = commonProps.$lib_version
    }

    if (Object.keys(defaultProps).length > 0) {
      this.setPersonPropertiesForFlags(defaultProps, reloadFeatureFlags)
    }
  }

  /**
   * Manually flushes the event queue.
   *
   * You can set the number of events in the configuration that should queue before flushing.
   * Setting this to 1 will send events immediately and will use more battery. This is set to 20 by default.
   * You can also manually flush the queue. If a flush is already in progress it returns a promise for the existing flush.
   *
   * Note: this drains the **events** pipeline only. Logs are flushed via
   * {@link flushLogs}, and {@link shutdown} drains both before terminating.
   *
   * {@label Capture}
   *
   * @example
   * ```js
   * // manually flush the queue
   * await posthog.flush()
   * ```
   *
   * @see flushLogs
   * @public
   *
   * @returns Promise that resolves when the flush is complete
   */
  flush(): Promise<void> {
    return super.flush()
  }

  /**
   * Captures a structured log record and sends it to PostHog's logs product
   * (`/i/v1/logs`). Low-level primitive — most callers will prefer
   * `posthog.logger.info(...)` / `.warn(...)` / `.error(...)` etc., which
   * wrap this with a level pre-set.
   *
   * Records are buffered per-session, rate-limited, batched into OTLP
   * payloads, and flushed on a timer, on AppState change, or when the
   * buffer reaches capacity. Configure flush cadence, rate cap, and a
   * `beforeSend` filter via the `logs` option on `new PostHog(...)`.
   *
   * Note — naming collision: `posthog.captureLog()` (this method) is the
   * **logs product** API. There is also a separate, pre-existing
   * `sessionReplayConfig.captureLog` boolean that controls whether
   * **session replay** records the device's `console.*` output. The two
   * are unrelated: this method emits structured records to the logs
   * pipeline regardless of whether session replay is on.
   *
   * {@label Capture}
   *
   * @example
   * ```ts
   * posthog.captureLog({
   *   body: 'checkout completed',
   *   level: 'info',
   *   attributes: { order_id: 'ord_789', amount_cents: 4999 },
   * })
   * ```
   *
   * @public
   *
   * @param options Log record. `body` is required; `level` defaults to
   *   `'info'`. `attributes` are attached as OTLP key-value attributes
   *   and will override auto-populated ones (distinctId, sessionId) on
   *   key conflict.
   */
  captureLog(options: CaptureLogOptions): void {
    this._logs.captureLog(options)
  }

  /**
   * Manually flushes the logs queue.
   *
   * Logs flush automatically on a timer, when the buffer fills, or on
   * AppState change — most apps never need to call this. Use it when you
   * want a synchronous-style hand-off (e.g. before navigating away from a
   * critical screen, in a custom crash handler, or while testing locally).
   *
   * If a flush is already in progress, both callers join the same in-flight
   * promise — no double-send.
   *
   * Note: this drains the **logs** pipeline only. Events are flushed via
   * {@link flush}, and {@link shutdown} drains both before terminating.
   *
   * {@label Capture}
   *
   * @example
   * ```ts
   * await posthog.flushLogs()
   * ```
   *
   * @see flush
   * @public
   *
   * @returns Promise that resolves when the flush is complete.
   */
  flushLogs(): Promise<void> {
    return this._logs.flush()
  }

  private _captureLogger?: CaptureLogger

  /**
   * Convenience per-level logger. Each method is shorthand for
   * `posthog.captureLog({ body, level, attributes })`. Lazily constructed
   * on first access, then reused.
   *
   * {@label Capture}
   *
   * @example
   * ```ts
   * posthog.logger.info('checkout completed', { order_id: 'ord_789' })
   * posthog.logger.error('payment failed', { code: 'E001' })
   * ```
   *
   * @public
   */
  get logger(): CaptureLogger {
    if (!this._captureLogger) {
      this._captureLogger = {
        trace: (body, attributes) => this.captureLog({ body, level: 'trace', attributes }),
        debug: (body, attributes) => this.captureLog({ body, level: 'debug', attributes }),
        info: (body, attributes) => this.captureLog({ body, level: 'info', attributes }),
        warn: (body, attributes) => this.captureLog({ body, level: 'warn', attributes }),
        error: (body, attributes) => this.captureLog({ body, level: 'error', attributes }),
        fatal: (body, attributes) => this.captureLog({ body, level: 'fatal', attributes }),
      }
    }
    return this._captureLogger
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
    // Consent must be durable. See reset()/identify().
    const result = super.optIn()
    void this._eventsStorage.waitForPersist()
    return result
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
    // Consent must be durable. See reset()/identify().
    const result = super.optOut()
    void this._eventsStorage.waitForPersist()
    return result
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

    // Automatically cache group properties for feature flag evaluation
    if (properties && Object.keys(properties).length > 0) {
      const propsToCache: Record<string, JsonType> = {}
      Object.keys(properties).forEach((key) => {
        const value = properties[key]
        if (value !== null && value !== undefined) {
          propsToCache[key] = value
        }
      })
      if (Object.keys(propsToCache).length > 0) {
        this.setGroupPropertiesForFlags({
          [groupType]: propsToCache,
        })
      }
    }
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
   * Returns the stable device identifier used for device-level feature flag bucketing.
   * This ID persists across identify() and reset() calls, only changing on a fresh
   * app install, manual cache clearing, or OS-initiated storage cleanup.
   *
   * @returns The device ID, or an empty string if not yet initialized
   */
  getDeviceId(): string {
    const deviceId = this.getPersistedProperty<string>(PostHogPersistedProperty.DeviceId)
    if (!deviceId) {
      // Lazy init for upgrades: existing installs won't have a device_id yet
      const anonId = this.getAnonymousId()
      if (anonId) {
        this.setPersistedProperty(PostHogPersistedProperty.DeviceId, anonId)
        return anonId
      }
      return ''
    }
    return deviceId
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
   * @param reloadFeatureFlags Whether to reload feature flags after setting the properties. Defaults to true.
   */
  setPersonPropertiesForFlags(properties: Record<string, JsonType>, reloadFeatureFlags = true): void {
    super.setPersonPropertiesForFlags(properties, reloadFeatureFlags)
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
   *
   * @param reloadFeatureFlags Whether to reload feature flags after setting the properties. Defaults to true.
   */
  resetPersonPropertiesForFlags(reloadFeatureFlags = true): void {
    super.resetPersonPropertiesForFlags()

    if (reloadFeatureFlags) {
      this.reloadFeatureFlags()
    }
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
   * @param reloadFeatureFlags Whether to reload feature flags after setting the properties. Defaults to true.
   */
  setGroupPropertiesForFlags(properties: Record<string, Record<string, JsonType>>, reloadFeatureFlags = true): void {
    super.setGroupPropertiesForFlags(properties)

    if (reloadFeatureFlags) {
      this.reloadFeatureFlags()
    }
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
   *
   * @param reloadFeatureFlags Whether to reload feature flags after setting the properties. Defaults to true.
   */
  resetGroupPropertiesForFlags(reloadFeatureFlags = true): void {
    super.resetGroupPropertiesForFlags()

    if (reloadFeatureFlags) {
      this.reloadFeatureFlags()
    }
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

  _resetSessionId(reactNativeSessionReplay: typeof OptionalReactNativePlugin | undefined, sessionId: string): void {
    // _resetSessionId is only called if reactNativeSessionReplay not undefined, but the linter wasn't happy
    if (reactNativeSessionReplay) {
      reactNativeSessionReplay.endSession()
      reactNativeSessionReplay.startSession(sessionId)
    }
  }

  getSessionId(): string {
    const sessionId = super.getSessionId()

    if (!this._isEnableSessionReplay() && !this._isNativePluginInitialized()) {
      return sessionId
    }

    // only rotate if there is a new sessionId and it is different from the current one
    if (sessionId.length > 0 && this._currentSessionId && sessionId !== this._currentSessionId) {
      if (OptionalReactNativePlugin) {
        try {
          this._resetSessionId(OptionalReactNativePlugin, String(sessionId))
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
    if ((this._isEnableSessionReplay() || this._isNativePluginInitialized()) && OptionalReactNativePlugin) {
      try {
        OptionalReactNativePlugin.endSession()
        this._logger.info(`Native PostHog session ended.`)
      } catch (e) {
        this._logger.error(`Native PostHog session failed to end: ${e}.`)
      }
    }
  }

  /**
   * Starts session recording.
   * This method will have no effect if PostHog is not enabled, or if session replay is disabled in your project settings.
   *
   * Note: This is only available on iOS and Android. On web/macOS, this is a no-op.
   *
   * Requires `posthog-react-native-session-replay` version 1.3.0 or higher.
   *
   * {@label Session Replay}
   *
   * @example
   * ```js
   * // Resume the current session recording
   * await posthog.startSessionRecording()
   * ```
   *
   * @example
   * ```js
   * // Start a new session recording
   * await posthog.startSessionRecording(false)
   * ```
   *
   * @public
   *
   * @param resumeCurrent - Whether to resume recording of current session (true) or start a new session (false). Defaults to true.
   */
  async startSessionRecording(resumeCurrent: boolean = true): Promise<void> {
    await this._startSessionRecording(resumeCurrent)
  }

  // Same as startSessionRecording, but reports success so callers can react to failures.
  private async _startSessionRecording(resumeCurrent: boolean): Promise<boolean> {
    await this._initPromise

    if (this.isDisabled) {
      return false
    }

    if (!OptionalReactNativePlugin) {
      // Web/macOS - silently return
      return false
    }

    try {
      // Check if the plugin supports startRecording
      if (!OptionalReactNativePlugin.startRecording) {
        this._logger.warn(
          'startRecording is not available. Please update @posthog/react-native-plugin or posthog-react-native-session-replay.'
        )
        return false
      }

      // If only error tracking is active, add replay to the existing native instance
      // rather than re-initializing.
      if (!this._sessionReplayNativeInitialized) {
        this._logger.info('Native session replay SDK not initialized, initializing now...')
        const initialized = await this.initializeNativePlugin(this._sessionReplayOptions, undefined, true)
        if (!initialized) {
          this._logger.error('Failed to initialize native session replay SDK.')
          return false
        }
      }

      // Handle session ID if not resuming
      if (!resumeCurrent) {
        super.resetSessionId()
        const newSessionId = super.getSessionId()
        // sync native + rn sessionId
        this._resetSessionId(OptionalReactNativePlugin, String(newSessionId))
        this._currentSessionId = newSessionId
      }

      await OptionalReactNativePlugin.startRecording(resumeCurrent)
      this._logger.info(`Session recording ${resumeCurrent ? 'resumed' : 'started'}.`)
      return true
    } catch (e) {
      this._logger.error(`Failed to start session recording: ${e}`)
      return false
    }
  }

  /**
   * Stops the current session recording if one is in progress.
   *
   * Note: This is only available on iOS and Android. On web/macOS, this is a no-op.
   *
   * Requires `posthog-react-native-session-replay` version 1.3.0 or higher.
   *
   * {@label Session Replay}
   *
   * @example
   * ```js
   * await posthog.stopSessionRecording()
   * ```
   * @public
   */
  async stopSessionRecording(): Promise<void> {
    await this._stopSessionRecording()
  }

  // Same as stopSessionRecording, but reports success so callers can react to failures.
  private async _stopSessionRecording(): Promise<boolean> {
    await this._initPromise

    if (this.isDisabled) {
      return false
    }

    if (!OptionalReactNativePlugin) {
      // Web/macOS - silently return
      return false
    }

    try {
      // Check if the plugin supports stopRecording
      if (!OptionalReactNativePlugin.stopRecording) {
        this._logger.warn(
          'stopRecording is not available. Please update @posthog/react-native-plugin or posthog-react-native-session-replay.'
        )
        return false
      }

      await OptionalReactNativePlugin.stopRecording()
      this._logger.info('Session recording stopped.')
      return true
    } catch (e) {
      this._logger.error(`Failed to stop session recording: ${e}`)
      return false
    }
  }

  /**
   * Returns whether session replay is currently active.
   *
   * Note: This is only available on iOS and Android. On web/macOS, this always returns false.
   *
   * {@label Session Replay}
   *
   * @example
   * ```js
   * const isActive = await posthog.isSessionReplayActive()
   * ```
   *
   * @public
   *
   * @returns Whether session replay is currently active
   */
  async isSessionReplayActive(): Promise<boolean> {
    await this._initPromise

    if (this.isDisabled) {
      return false
    }

    if (!OptionalReactNativePlugin) {
      // Web/macOS - always return false
      return false
    }

    try {
      return await OptionalReactNativePlugin.isEnabled()
    } catch (e) {
      this._logger.error(`Failed to check session replay status: ${e}`)
      return false
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

    // Extract $set_once before super.identify() because core deletes it from the properties object
    const userProps = properties?.$set || properties
    const userPropsOnce = properties?.$set_once

    super.identify(distinctId, properties, options)

    // Automatically cache person properties for feature flag evaluation

    const propsToCache: Record<string, JsonType> = {}
    if (userProps && typeof userProps === 'object' && !Array.isArray(userProps)) {
      Object.entries(userProps).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          propsToCache[key] = value
        }
      })
    }

    const propsOnceToCache: Record<string, JsonType> = {}
    if (userPropsOnce && typeof userPropsOnce === 'object' && !Array.isArray(userPropsOnce)) {
      Object.entries(userPropsOnce).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          propsOnceToCache[key] = value
        }
      })
    }

    if (Object.keys(propsToCache).length > 0 || Object.keys(propsOnceToCache).length > 0) {
      // super.identify() already handles reloading flags in all cases:
      // - When distinctId changes: it calls reloadFeatureFlags() directly
      // - When distinctId is the same but properties change: it calls setPersonProperties() which reloads flags
      // So we only need to set the properties here without triggering another reload.
      this.setPersonPropertiesForFlags(
        {
          $set: propsToCache,
          ...(Object.keys(propsOnceToCache).length > 0 ? { $set_once: propsOnceToCache } : {}),
        },
        false
      )
    }

    if ((this._isEnableSessionReplay() || this._isNativePluginInitialized()) && OptionalReactNativePlugin) {
      try {
        distinctId = distinctId || previousDistinctId
        const anonymousId = this.getAnonymousId()
        OptionalReactNativePlugin.identify(String(distinctId), String(anonymousId))
        this._logger.info(`Native PostHog identified with distinctId ${distinctId} and anonymousId ${anonymousId}.`)
      } catch (e) {
        this._logger.error(`Native PostHog failed to identify: ${e}.`)
      }
    }

    // Account-switch safety — same as reset().
    void this._eventsStorage.waitForPersist()
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
  captureException(
    error: Error | unknown,
    additionalProperties: PostHogEventProperties = {},
    hint?: CoreErrorTracking.EventHint
  ): void {
    const resolvedHint: CoreErrorTracking.EventHint = hint ?? {
      mechanism: { handled: true, type: 'generic' },
      syntheticException: new Error('Synthetic Error'),
    }

    // Attach the rolling exception-steps buffer (no-op if the caller already provided their own).
    additionalProperties = this._errorTracking.attachExceptionSteps(additionalProperties)

    super.captureException(error, additionalProperties, resolvedHint)

    // On a fatal crash, persist the exception + recent logs before the app may die.
    if (additionalProperties?.$exception_level === 'fatal') {
      void this._eventsStorage.waitForPersist()
      void this._logsStorage.waitForPersist()
    }
  }

  /**
   * Records a breadcrumb-style exception step. Steps accumulate in a rolling, byte-bounded buffer
   * and are attached to every captured `$exception` as `$exception_steps`, giving the error tracking
   * UI a timeline of recent activity before each error.
   *
   * The `$timestamp` is captured at call time. The reserved keys `$message` and `$timestamp` are
   * stripped from `properties` — the SDK sets the canonical values. This method never throws.
   *
   * @example
   * ```js
   * posthog.addExceptionStep('User tapped Checkout', { screen: 'cart' })
   * ```
   *
   * @param {string} message A non-empty description of the step
   * @param {Object} [properties] Optional additional context to attach to the step
   * @returns {void}
   */
  addExceptionStep(message: string, properties?: PostHogEventProperties): void {
    this._errorTracking.addExceptionStep(message, properties)
    // Mirror the step to the embedded native SDK so native crashes carry the same steps.
    this._forwardExceptionStepToNative(message, properties)
  }

  private _forwardExceptionStepToNative(message: string, properties?: PostHogEventProperties): void {
    if (!this._nativeErrorTrackingInitialized || !OptionalReactNativePlugin?.addExceptionStep) {
      return
    }
    // Fire-and-forget: the native layer validates and buffers independently and must never block.
    void Promise.resolve(OptionalReactNativePlugin.addExceptionStep(message, properties)).catch((e) => {
      this._logger.warn(`Failed to forward exception step to native: ${e}`)
    })
  }

  protected override createErrorPropertiesBuilder(): CoreErrorTracking.ErrorPropertiesBuilder {
    return new CoreErrorTracking.ErrorPropertiesBuilder(
      [
        new CoreErrorTracking.PromiseRejectionEventCoercer(),
        new CoreErrorTracking.ErrorCoercer(),
        new CoreErrorTracking.ErrorEventCoercer(),
        new CoreErrorTracking.ObjectCoercer(),
        new CoreErrorTracking.StringCoercer(),
        new CoreErrorTracking.PrimitiveCoercer(),
      ],
      CoreErrorTracking.createStackParser(
        isHermes() ? 'hermes' : 'web:javascript',
        CoreErrorTracking.chromeStackLineParser,
        CoreErrorTracking.geckoStackLineParser
      )
    )
  }

  initReactNativeNavigation(options: PostHogAutocaptureOptions): boolean {
    return withReactNativeNavigation(this, options)
  }

  /**
   * Creates a person profile for the current user, if they don't already have one.
   *
   * This is useful when using `personProfiles: 'identified_only'` mode and you want to
   * explicitly create a profile for an anonymous user before they identify.
   *
   * If `personProfiles` is 'identified_only' and no profile exists, this will create one.
   * If `personProfiles` is 'never', this will log an error and do nothing.
   * If `personProfiles` is 'always' or a profile already exists, this is a no-op.
   *
   * {@label Identification}
   *
   * @example
   * ```js
   * // Create a person profile for an anonymous user
   * posthog.createPersonProfile()
   * ```
   *
   * @public
   */
  createPersonProfile(): void {
    super.createPersonProfile()
  }

  /**
   * Sets properties on the person profile associated with the current `distinct_id`.
   * Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify)
   *
   * {@label Identification}
   *
   * @remarks
   * Updates user properties that are stored with the person profile in PostHog.
   * If `personProfiles` is set to `identified_only` and no profile exists, this will create one.
   *
   * @example
   * ```js
   * // set user properties
   * posthog.setPersonProperties({
   *     email: 'user@example.com',
   *     plan: 'premium'
   * })
   * ```
   *
   * @example
   * ```js
   * // set properties with $set_once
   * posthog.setPersonProperties(
   *     { name: 'Max Hedgehog' },  // $set properties
   *     { initial_url: '/blog' }   // $set_once properties
   * )
   * ```
   *
   * @example
   * ```js
   * // set properties without reloading feature flags
   * posthog.setPersonProperties({ plan: 'premium' }, undefined, false)
   * ```
   *
   * @public
   *
   * @param userPropertiesToSet - Optional: An object of properties to store about the user.
   *   These properties will overwrite any existing values for the same keys.
   * @param userPropertiesToSetOnce - Optional: An object of properties to store about the user.
   *   If a property is previously set, this does not override that value.
   * @param reloadFeatureFlags - Whether to reload feature flags after setting the properties. Defaults to true.
   */
  setPersonProperties(
    userPropertiesToSet?: { [key: string]: JsonType },
    userPropertiesToSetOnce?: { [key: string]: JsonType },
    reloadFeatureFlags = true
  ): void {
    super.setPersonProperties(userPropertiesToSet, userPropertiesToSetOnce, reloadFeatureFlags)
  }

  /**
   * Removes properties from the person profile associated with the current `distinct_id`.
   * Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify)
   *
   * {@label Identification}
   *
   * @public
   *
   * @param propertyNames - The name (or names) of the person properties to remove.
   * @param reloadFeatureFlags - Whether to reload feature flags after removing the properties. Defaults to true.
   */
  unsetPersonProperties(propertyNames: string | string[], reloadFeatureFlags = true): void {
    super.unsetPersonProperties(propertyNames, reloadFeatureFlags)
  }

  public async getSurveys(): Promise<SurveyResponse['surveys']> {
    if (this._disableSurveys === true) {
      this._logger.info('Loading surveys is disabled.')
      this._cacheSurveys(null, 'disabled in config')
      return []
    }

    const surveys = this.getPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys)

    if (surveys && surveys.length > 0) {
      this._logger.info('Surveys fetched from storage: ', JSON.stringify(surveys))
      return surveys
    }

    this._logger.info('No surveys found in storage')
    return []
  }

  /**
   * Returns a promise that resolves when surveys are ready to be loaded.
   * If surveys are already loaded and ready to go, returns a resolved promise instead.
   * @internal
   */
  _onSurveysReady(): Promise<void> {
    if (this._surveysReady) {
      // If surveys are already ready, resolve immediately
      return Promise.resolve()
    }

    if (!this._surveysReadyPromise) {
      this._surveysReadyPromise = new Promise<void>((resolve) => {
        this._surveysReadyResolve = resolve
      })
    }

    return this._surveysReadyPromise
  }

  private _surveysReadyResolve: (() => void) | null = null

  /**
   * Helper function to cache surveys to storage with consistent logging
   */
  private _cacheSurveys(surveys: Survey[] | null, source: string): void {
    this.setPersistedProperty<SurveyResponse['surveys']>(PostHogPersistedProperty.Surveys, surveys)

    if (surveys && surveys.length > 0) {
      this._logger.info(`Surveys cached from ${source}:`, JSON.stringify(surveys))
    } else if (surveys === null) {
      this._logger.info(`Surveys cleared (${source})`)
    } else {
      this._logger.info(`No surveys to cache from ${source})`)
    }
  }

  /**
   * Internal method to notify that surveys are ready
   */
  private _notifySurveysReady(): void {
    this._surveysReady = true
    if (this._surveysReadyResolve) {
      this._surveysReadyResolve()
      this._surveysReadyResolve = null
      this._surveysReadyPromise = null
    }
  }

  /**
   * Handle surveys from remote config response
   */
  private _handleSurveysFromRemoteConfig(response: any): void {
    if (this._disableSurveys === true) {
      this._logger.info('Loading surveys skipped, disabled.')
      this._cacheSurveys(null, 'remote config (disabled)')
      return
    }

    const surveys = response.surveys

    // If surveys is not an array, it means there are no surveys (its a boolean)
    if (Array.isArray(surveys) && surveys.length > 0) {
      this._cacheSurveys(surveys as Survey[], 'remote config')
    } else {
      this._cacheSurveys(null, 'remote config')
    }
  }

  /**
   * Load flags AND handle surveys from the flags response (only when remote config is disabled)
   */
  private async _flagsAsyncWithSurveys(): Promise<void> {
    try {
      const flagsResponse = await this.flagsAsync({
        sendAnonDistinctId: true,
        fetchConfig: true,
        triggerOnRemoteConfig: true,
      })

      // Only handle surveys from flags if remote config is disabled and surveys are enabled
      // When remote config is enabled, surveys will come from there instead
      if (this._disableRemoteConfig === true) {
        if (this._disableSurveys === true) {
          this._logger.info('Loading surveys skipped, disabled.')
          this._cacheSurveys(null, 'flags (disabled)')
          return
        }

        // Handle surveys from the response (surveys key is included when config=true)
        const surveys = flagsResponse?.surveys

        // If surveys is not an array, it means there are no surveys (its a boolean)
        if (Array.isArray(surveys) && surveys.length > 0) {
          this._cacheSurveys(surveys as Survey[], 'flags endpoint')
        } else {
          this._logger.info('No surveys in flags response')
          this._cacheSurveys(null, 'flags endpoint')
        }
      }
    } catch (error) {
      this._logger.error('Error in _flagsAsyncWithSurveys:', error)
    }
  }

  /**
   * Internal method to load surveys from API (when remote config is disabled)
   */
  private async _loadSurveysFromAPI(): Promise<void> {
    if (this._disableSurveys === true) {
      this._logger.info('Loading surveys skipped, disabled.')
      this._cacheSurveys(null, 'API (disabled)')
      return
    }

    try {
      const surveysFromApi = await super.getSurveysStateless()
      if (surveysFromApi && surveysFromApi.length > 0) {
        this._cacheSurveys(surveysFromApi, 'API')
      } else {
        this._cacheSurveys(null, 'API')
      }
    } catch (error) {
      this._logger.error('Error loading surveys from API:', error)
    }
  }

  private _isAutocaptureNativeErrors(options?: PostHogOptions): boolean {
    const autocapture = options?.errorTracking?.autocapture
    const nativeCrashes = typeof autocapture === 'object' && autocapture.nativeCrashes === true
    return !this.isDisabled && nativeCrashes
  }

  private _isNativePluginInitialized(): boolean {
    return this._sessionReplayNativeInitialized || this._nativeErrorTrackingInitialized
  }

  /**
   * Initializes the native session replay SDK if not already initialized.
   * This is called automatically by startSessionReplay() or lazily by startSessionRecording().
   *
   * @returns true if the native SDK is ready (initialized or already was), false otherwise
   */
  private async initializeSessionReplayNative(
    options?: PostHogOptions,
    cachedRemoteConfig?: Omit<PostHogRemoteConfig, 'surveys'>
  ): Promise<boolean> {
    return this.initializeNativePlugin(options, cachedRemoteConfig, true)
  }

  private async initializeNativePlugin(
    options?: PostHogOptions,
    cachedRemoteConfig?: Omit<PostHogRemoteConfig, 'surveys'>,
    enableSessionReplay: boolean = this._isEnableSessionReplay()
  ): Promise<boolean> {
    let enableNativeErrorTracking = this._isAutocaptureNativeErrors(options)

    if (!enableSessionReplay && !enableNativeErrorTracking) {
      return true
    }

    if (!OptionalReactNativePlugin) {
      this._logger.warn(
        enableSessionReplay
          ? 'Session replay enabled but not installed.'
          : 'Native error tracking enabled but not installed.'
      )
      return false
    }

    if (
      (!enableSessionReplay || this._sessionReplayNativeInitialized) &&
      (!enableNativeErrorTracking || this._nativeErrorTrackingInitialized)
    ) {
      return true
    }

    // The native SDKs can't be re-initialized — a second setup() would reset the running
    // instance. If error tracking is already running, skip setup() and start replay on the
    // existing native instance instead (setup() is what would otherwise start it).
    if (this._isNativePluginInitialized() && enableSessionReplay && !this._sessionReplayNativeInitialized) {
      this._sessionReplayNativeInitialized = true
      await OptionalReactNativePlugin.startRecording?.(true)
      return true
    }

    const sessionId = this.getSessionId()
    if (sessionId.length === 0) {
      this._logger.warn(`Native PostHog plugin enabled but no sessionId found.`)
      return false
    }

    const defaultThrottleDelayMs = 1000

    const {
      maskAllTextInputs = true,
      maskAllImages = true,
      maskAllSandboxedViews = true,
      captureLog: localCaptureLog = true,
      captureNetworkTelemetry: localCaptureNetworkTelemetry = true,
      screenshotModeBackgroundCapture = false,
      sampleRate: localSampleRate,
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

    // Gate captureLog and captureNetworkTelemetry using cached remote config.
    // The effective state is: localEnabled AND remoteEnabled.
    // If remote config hasn't loaded yet (no cached value), defaults to true (don't block locally enabled capture).
    const remoteConsoleLogEnabled = getRemoteConfigBool(
      cachedRemoteConfig?.sessionRecording,
      'consoleLogRecordingEnabled',
      true
    )
    const remoteNetworkTimingEnabled = getRemoteConfigBool(
      cachedRemoteConfig?.capturePerformance,
      'network_timing',
      true
    )
    const remoteSampleRateRaw = getRemoteConfigNumber(cachedRemoteConfig?.sessionRecording, 'sampleRate')

    const captureLog = localCaptureLog && remoteConsoleLogEnabled
    const captureNetworkTelemetry = localCaptureNetworkTelemetry && remoteNetworkTimingEnabled

    const localSampleRateValid =
      localSampleRate === undefined ? undefined : isValidSampleRate(localSampleRate) ? localSampleRate : undefined
    const remoteSampleRateValid =
      remoteSampleRateRaw === undefined
        ? undefined
        : isValidSampleRate(remoteSampleRateRaw)
          ? remoteSampleRateRaw
          : undefined

    const sampleRate = localSampleRateValid ?? remoteSampleRateValid

    if (localCaptureLog && !remoteConsoleLogEnabled) {
      this._logger.info('captureLog disabled by remote config (consoleLogRecordingEnabled=false).')
    }
    if (localCaptureNetworkTelemetry && !remoteNetworkTimingEnabled) {
      this._logger.info('captureNetworkTelemetry disabled by remote config (capturePerformance.network_timing=false).')
    }
    if (localSampleRate !== undefined && localSampleRateValid === undefined) {
      this._logger.warn(
        `Ignoring invalid sessionReplayConfig.sampleRate '${localSampleRate}'. Expected a number between 0 and 1.`
      )
    }
    if (remoteSampleRateRaw !== undefined && remoteSampleRateValid === undefined) {
      this._logger.warn(
        `Ignoring invalid remote config sessionRecording.sampleRate '${remoteSampleRateRaw}'. Expected a number between 0 and 1.`
      )
    }
    if (typeof sampleRate === 'number') {
      const source = localSampleRateValid !== undefined ? 'local config' : 'remote config'
      this._logger.info(`sampleRate set from ${source} (${sampleRate}).`)
    }

    const sdkReplayConfig = {
      maskAllTextInputs,
      maskAllImages,
      maskAllSandboxedViews,
      captureLog,
      captureNetworkTelemetry,
      screenshotModeBackgroundCapture,
      sampleRate,
      iOSdebouncerDelayMs,
      androidDebouncerDelayMs,
      throttleDelayMs,
    }

    this._logger.info(`Native PostHog plugin replay config: ${JSON.stringify(sdkReplayConfig)}`)

    // if Flags API has not returned yet, we will start session replay with default config.
    const sessionReplay = this.getPersistedProperty(PostHogPersistedProperty.SessionReplay) ?? {}
    const cachedSessionReplayConfig = (sessionReplay as { [key: string]: JsonType }) ?? {}

    this._logger.info(
      `Session replay session recording from flags cached config: ${JSON.stringify(cachedSessionReplayConfig)}`
    )

    const sdkOptions = {
      apiKey: this.apiKey,
      host: this.host,
      debug: this.isDebug,
      distinctId: this.getDistinctId(),
      anonymousId: this.getAnonymousId(),
      sdkVersion: this.getLibraryVersion(),
      flushAt: this.flushAt,
    }

    this._logger.info(`Native PostHog plugin sdk options: ${JSON.stringify(sdkOptions)}`)

    try {
      const wasSessionReplayEnabled = enableSessionReplay
        ? await OptionalReactNativePlugin.isEnabled().catch(() => false)
        : false

      if (OptionalReactNativePlugin.setup) {
        const pluginConfig = {
          sessionReplay: {
            enabled: enableSessionReplay,
            sdkReplayConfig,
            decideReplayConfig: cachedSessionReplayConfig,
          },
          errorTracking: {
            nativeAutocapture: enableNativeErrorTracking,
            exceptionSteps: this._errorTracking.getNativePluginExceptionStepsConfig(),
          },
        }
        await OptionalReactNativePlugin.setup(String(sessionId), sdkOptions, pluginConfig)
        if (wasSessionReplayEnabled) {
          // if somehow the SDK is already enabled with a different sessionId, we reset it
          this._resetSessionId(OptionalReactNativePlugin, String(sessionId))
        }
      } else {
        if (enableNativeErrorTracking) {
          this._logger.warn(
            'Native error tracking is not available. Please update @posthog/react-native-plugin or posthog-react-native-session-replay.'
          )
          // The legacy plugin can't do native crash capture, so don't mark it initialized below.
          enableNativeErrorTracking = false
        }
        if (!enableSessionReplay) {
          return false
        }
        if (!(await OptionalReactNativePlugin.isEnabled())) {
          await OptionalReactNativePlugin.start(
            String(sessionId),
            sdkOptions,
            sdkReplayConfig,
            cachedSessionReplayConfig
          )
        } else {
          // if somehow the SDK is already enabled with a different sessionId, we reset it
          this._resetSessionId(OptionalReactNativePlugin, String(sessionId))
        }
      }
      this._currentSessionId = sessionId
      if (enableSessionReplay) {
        this._sessionReplayNativeInitialized = true
        this._logger.info(`Session replay started with sessionId ${sessionId}.`)
      }
      if (enableNativeErrorTracking) {
        this._nativeErrorTrackingInitialized = true
        this._logger.info('Native error tracking started.')
      }
      return true
    } catch (e) {
      this._logger.error(`Native PostHog plugin failed to start: ${e}.`)
      return false
    }
  }

  private async startSessionReplay(
    options?: PostHogOptions,
    cachedRemoteConfig?: Omit<PostHogRemoteConfig, 'surveys'>
  ): Promise<void> {
    this._enableSessionReplay = options?.enableSessionReplay
    this._sessionReplayOptions = options

    await this._evaluateAndStartSessionReplay(cachedRemoteConfig)
  }

  /**
   * Decides whether session replay should be recording (replay enabled AND the linked
   * flag, if any, on for the current user) and arms or pauses the native recorder to match.
   *
   * Runs at startup and on every feature flags load/reload (identify(), reset(),
   * reloadFeatureFlags()), so recording starts, resumes, or pauses on identity changes
   * without an app restart. `_sessionReplayRecordingActive` dedups repeated answers, and
   * the init guards prevent double-starts. When replay is off, the native plugin is still
   * initialized for native error tracking (both share one native instance).
   *
   * Pausing requires a real "flag off": core keeps the previous flag values across
   * quota-limited/failed reloads, so a transient error never pauses a recording. Right
   * after reset() the flags are genuinely unknown and pausing is the intended outcome.
   *
   * Evaluations are serialized so concurrent flags reloads run one at a time.
   */
  private _evaluateAndStartSessionReplay(cachedRemoteConfig?: Omit<PostHogRemoteConfig, 'surveys'>): Promise<void> {
    this._sessionReplayEvalChain = this._sessionReplayEvalChain
      .catch(() => {})
      .then(() => this._evaluateAndStartSessionReplayInternal(cachedRemoteConfig))
    return this._sessionReplayEvalChain
  }

  private async _evaluateAndStartSessionReplayInternal(
    cachedRemoteConfig?: Omit<PostHogRemoteConfig, 'surveys'>
  ): Promise<void> {
    const options = this._sessionReplayOptions
    const enableNativeErrorTracking = this._isAutocaptureNativeErrors(options)
    // On the re-arm path (flags reloaded after identify/reset) cachedRemoteConfig
    // isn't passed in, so fall back to the persisted remote config for capture gating.
    const remoteConfig =
      cachedRemoteConfig ??
      this.getPersistedProperty<Omit<PostHogRemoteConfig, 'surveys'>>(PostHogPersistedProperty.RemoteConfig)

    if (!this._isEnableSessionReplay()) {
      this._logger.info('Session replay is not enabled.')
      if (enableNativeErrorTracking) {
        await this.initializeNativePlugin(options, remoteConfig, false)
      }
      return
    }

    // if Flags API has not returned yet, we will start session replay with default config.
    const sessionReplay = this.getPersistedProperty(PostHogPersistedProperty.SessionReplay) ?? {}
    const featureFlags = this.getKnownFeatureFlags() ?? {}
    const cachedFeatureFlags = (featureFlags as { [key: string]: FeatureFlagValue }) ?? {}
    const cachedSessionReplayConfig = (sessionReplay as { [key: string]: JsonType }) ?? {}

    this._logger.info('Session replay feature flags from flags cached config:', JSON.stringify(cachedFeatureFlags))

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
      if (this._sessionReplayRecordingActive === true) {
        // Already recording — nothing to do.
        return
      }
      // Record the actual outcome; on failure it stays false so the next reload retries.
      // (Already initialized means replay was paused by an earlier flag-off, so resume it.)
      this._sessionReplayRecordingActive = this._sessionReplayNativeInitialized
        ? await this._startSessionRecording(true)
        : await this.initializeNativePlugin(options, remoteConfig, true)
    } else {
      this._logger.info('Session replay disabled.')

      if (this._sessionReplayRecordingActive === true) {
        // Linked flag turned off — pause so a gated-off user isn't recorded. Keep the flag
        // set if the native stop fails, so the next reload retries instead of giving up.
        this._sessionReplayRecordingActive = !(await this._stopSessionRecording())
      } else {
        this._sessionReplayRecordingActive = false
      }

      if (enableNativeErrorTracking) {
        await this.initializeNativePlugin(options, remoteConfig, false)
      }
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
