import type { PostHog } from '../posthog-rn'
import {
  JsonType,
  Logger,
  ErrorTracking as CoreErrorTracking,
  isPostHogFetchNetworkError,
  isNullish,
  isObject,
  isString,
  PostHogEventProperties,
  uuidv7,
} from '@posthog/core'
import { Properties } from '@posthog/types'
import { trackConsole, trackUncaughtExceptions, trackUnhandledRejections } from './utils'
import { getRemoteConfigBool } from '../utils'
import { OptionalReactNativePlugin } from '../optional/OptionalPlugin'
import { buildFatalExceptionPayload } from './fatal-payload'

type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error'

const LogLevelList: LogLevel[] = ['debug', 'log', 'info', 'warn', 'error']

// user provided configuration
interface AutocaptureOptions {
  uncaughtExceptions?: boolean
  unhandledRejections?: boolean
  console?: boolean | LogLevel[]
  /**
   * Enables native iOS/Android/macOS crash autocapture through the optional native plugin.
   * On Android this covers Java/Kotlin crashes; native C/C++ (NDK) crashes are enabled with
   * `androidNdkCrashes`. On Apple platforms it covers signal crashes too.
   * Disabled by default. Requires `@posthog/react-native-plugin` installed (2.2.0 or newer for macOS).
   */
  nativeCrashes?: boolean
  /**
   * Enables autocapture of native C/C++ (NDK) crashes on Android, through the optional native
   * plugin. Requires Android 12 (API 31) or later and exception autocapture enabled in the
   * project's error tracking settings.
   *
   * An NDK crash kills the process immediately, so it is captured on the next app launch from
   * the records the OS kept, which means properties such as `$app_version` and the identity
   * describe that launch rather than the crash. The first launch after enabling this also
   * captures the native crashes the OS still holds from before.
   *
   * For readable stack traces, upload the app's `.so` debug symbols. With Expo, set `uploadNativeSymbols`
   * on the `posthog-react-native/expo` config plugin: https://posthog.com/docs/error-tracking/upload-source-maps/react-native#native-crash-symbolication
   *
   * Ignored on other platforms. Disabled by default. Requires `@posthog/react-native-plugin` 2.12.0 or newer.
   */
  androidNdkCrashes?: boolean
}

/**
 * Controls the breadcrumb-style exception steps recorded via `addExceptionStep` and attached
 * to captured exceptions as `$exception_steps`.
 */
export interface ExceptionStepsOptions {
  /**
   * Whether exception steps are recorded and attached.
   * @default true
   */
  enabled?: boolean
  /**
   * Total UTF-8 byte budget (~32KB) for the in-memory buffer. Oldest steps are evicted first when exceeded.
   * @default 32768
   */
  maxBytes?: number
}

export interface ErrorTrackingOptions {
  autocapture?: AutocaptureOptions | boolean
  exceptionSteps?: ExceptionStepsOptions
}

// resolved configuration
interface ResolvedAutocaptureOptions {
  uncaughtExceptions: boolean
  unhandledRejections: boolean
  console: LogLevel[]
}

interface ResolvedErrorTrackingOptions {
  autocapture: ResolvedAutocaptureOptions
}

// Hooks supplied by PostHogRN for coordinating the fatal capture with its event storage.
// Storage readiness is explicit so unknown persisted consent fails closed rather than being
// mistaken for the in-memory default.
interface FatalCaptureHooks {
  // `prepareNativeCapture` is offered the final, before_send-accepted message at the moment
  // it would be enqueued. Returning a thunk transfers ownership of the exception to the
  // native SDK and the JS queue copy is dropped; returning undefined leaves the event in the
  // JS queue as usual. The choice has to be made there, in one step, so a payload that fails
  // to build cannot leave the exception dropped from both queues.
  captureFatalException: (
    error: unknown,
    hint: CoreErrorTracking.EventHint,
    eventUuid: string,
    timestamp: Date,
    prepareNativeCapture: (queued: PostHogEventProperties) => (() => Promise<void>) | undefined
  ) => { queued: boolean; nativeCapture?: () => Promise<void> }
  waitForJSPersist: () => Promise<boolean>
  waitForStorageReady: () => Promise<boolean>
  getPersistenceMode: () => 'memory' | 'file' | undefined
  // Both native SDKs silently no-op a capture before setup() has run. Native init is async
  // and happens after the storage preload, so an early-startup crash can arrive first —
  // exactly the crashes this path exists for. Ownership only transfers once native is up.
  isNativeCaptureReady: () => boolean
}

export class ErrorTracking {
  private logger: Logger
  private options: ResolvedErrorTrackingOptions
  private _exceptionStepsConfig: CoreErrorTracking.ResolvedExceptionStepsConfig
  private _exceptionStepsBuffer: CoreErrorTracking.ExceptionStepsBuffer
  private _nativeForwardingEnabled: boolean = false
  private _unsubscribeUncaughtExceptions?: () => void

  /**
   * Controls whether autocaptured exceptions are actually sent.
   * When remote config disables error tracking, this is set to false
   * so that installed handlers become no-ops.
   * Defaults to true (don't block locally enabled capture before remote config loads).
   */
  private _autocaptureEnabled: boolean = true

  constructor(
    private instance: PostHog,
    options: ErrorTrackingOptions = {},
    logger: Logger,
    private readonly fatalCaptureHooks?: FatalCaptureHooks
  ) {
    this.logger = logger.createLogger('[ErrorTracking]')
    this.options = this.resolveOptions(options)
    const exceptionSteps = options.exceptionSteps
    this._exceptionStepsConfig = CoreErrorTracking.resolveExceptionStepsConfig(
      exceptionSteps ? { enabled: exceptionSteps.enabled, max_bytes: exceptionSteps.maxBytes } : undefined
    )
    this._exceptionStepsBuffer = new CoreErrorTracking.ExceptionStepsBuffer(this._exceptionStepsConfig)
    this.autocapture(this.options.autocapture)
  }

  /**
   * Exception-steps config in the native plugin's shape, so the embedded native SDK keeps one
   * logical buffer with the same byte budget and enabled state.
   */
  getNativePluginExceptionStepsConfig(): ExceptionStepsOptions {
    return { enabled: this._exceptionStepsConfig.enabled, maxBytes: this._exceptionStepsConfig.max_bytes }
  }

  /**
   * Records a breadcrumb-style exception step in the instance buffer and mirrors it to the embedded
   * native SDK. The `$timestamp` is captured at call time. Invalid messages are ignored with a
   * warning and never throw. The step only reaches native when it was actually buffered.
   */
  addExceptionStep(message: string, properties?: Properties): void {
    if (!this._exceptionStepsConfig.enabled) {
      return
    }

    try {
      if (!isString(message) || message.trim().length === 0) {
        this.logger.warn('Ignoring exception step because message must be a non-empty string')
        return
      }

      const userProperties = isObject(properties) ? { ...properties } : {}
      const { sanitizedProperties, droppedKeys } = CoreErrorTracking.stripReservedExceptionStepFields(userProperties)

      if (droppedKeys.length > 0) {
        this.logger.warn('Ignoring reserved exception step fields', { droppedKeys })
      }

      this._exceptionStepsBuffer.add({
        [CoreErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE]: message,
        [CoreErrorTracking.EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP]: new Date().toISOString(),
        ...sanitizedProperties,
      })
      this.forwardExceptionStepToNative(message, properties)
    } catch (error) {
      this.logger.error('Failed to add exception step. Ignoring breadcrumb.', error)
    }
  }

  /**
   * Native error tracking initializes asynchronously, so steps recorded before then are buffered
   * only in JS. The host calls this once native is ready to enable forwarding and replay the buffer,
   * so a native crash shortly after startup carries the steps recorded before native was ready.
   */
  onNativeErrorTrackingReady(): void {
    this._nativeForwardingEnabled = true
    for (const step of this.getAttachableExceptionSteps()) {
      this.forwardExceptionStepToNative(step.$message, step as Properties)
    }
  }

  private forwardExceptionStepToNative(message: string, properties?: Properties): void {
    if (!this._nativeForwardingEnabled || !OptionalReactNativePlugin?.addExceptionStep) {
      return
    }
    try {
      // Fire-and-forget: the native layer validates and buffers independently and must never block.
      void Promise.resolve(OptionalReactNativePlugin.addExceptionStep(message, properties)).catch((e) => {
        this.logger.warn(`Failed to forward exception step to native: ${e}`)
      })
    } catch (e) {
      this.logger.warn(`Failed to forward exception step to native: ${e}`)
    }
  }

  /**
   * Returns `properties` with a snapshot of the buffered steps attached as `$exception_steps`,
   * unless the feature is disabled, the caller already provided that key, or the buffer is empty.
   * The buffer is left intact so subsequent exceptions read the same steps.
   */
  attachExceptionSteps(properties: PostHogEventProperties): PostHogEventProperties {
    if (!this._exceptionStepsConfig.enabled || !isNullish(properties.$exception_steps)) {
      return properties
    }
    const steps = this.getAttachableExceptionSteps()
    if (steps.length === 0) {
      return properties
    }
    // Steps are already normalized to their JSON-safe wire form by the buffer.
    return { ...properties, $exception_steps: steps as unknown as JsonType }
  }

  /**
   * Snapshot of the buffered steps (oldest first), or an empty array when disabled or empty.
   */
  getAttachableExceptionSteps(): CoreErrorTracking.ExceptionStep[] {
    if (!this._exceptionStepsConfig.enabled) {
      return []
    }
    try {
      return this._exceptionStepsBuffer.getAttachable()
    } catch (error) {
      this.logger.error('Failed to read buffered exception steps.', error)
      return []
    }
  }

  /**
   * Clears the buffer. Called on SDK close, not on capture or identity changes.
   */
  clearExceptionSteps(): void {
    this._exceptionStepsBuffer.clear()
  }

  shutdown(): void {
    this._autocaptureEnabled = false
    this._unsubscribeUncaughtExceptions?.()
    this._unsubscribeUncaughtExceptions = undefined
    this.clearExceptionSteps()
  }

  /**
   * Called when remote config is loaded.
   * If errorTracking.autocaptureExceptions is explicitly false, autocapture is disabled.
   * If it's true or undefined (not yet loaded / not present), autocapture follows local config.
   */
  onRemoteConfig(errorTracking: boolean | { [key: string]: JsonType } | undefined): void {
    if (errorTracking == null) {
      // Remote config doesn't include errorTracking — don't change anything
      return
    }

    // Default to false: if remote config is present but the key is missing, disable autocapture
    this._autocaptureEnabled = getRemoteConfigBool(errorTracking, 'autocaptureExceptions', false)

    this.logger.info(
      `Error tracking autocapture ${this._autocaptureEnabled ? 'enabled' : 'disabled'} by remote config.`
    )
  }

  /**
   * Whether the app asked for fatal JavaScript exceptions to be autocaptured. This is the
   * locally configured value, deliberately not gated on the remote kill-switch: it decides
   * whether the native SDK is worth initializing, and that happens before remote config has
   * been fetched.
   */
  isUncaughtExceptionAutocaptureEnabled(): boolean {
    return this.options.autocapture.uncaughtExceptions
  }

  private resolveOptions(options: ErrorTrackingOptions): ResolvedErrorTrackingOptions {
    const autocaptureOptions = this.resolveAutocaptureOptions(options.autocapture)
    return {
      autocapture: autocaptureOptions,
    }
  }

  private resolveAutocaptureOptions(autocapture: AutocaptureOptions | boolean = false): ResolvedAutocaptureOptions {
    if (typeof autocapture === 'boolean') {
      return {
        uncaughtExceptions: autocapture,
        unhandledRejections: autocapture,
        console: [],
      }
    }
    return {
      uncaughtExceptions: !!autocapture.uncaughtExceptions,
      unhandledRejections: !!autocapture.unhandledRejections,
      console: this.resolveConsoleOptions(autocapture.console),
    }
  }

  private resolveConsoleOptions(console: boolean | LogLevel[] = false): LogLevel[] {
    if (typeof console === 'boolean') {
      return console ? ['error'] : []
    }
    return Array.isArray(console) ? console.filter((level) => LogLevelList.includes(level)) : []
  }

  private autocaptureUncaughtErrors() {
    const onUncaughtException = (error: unknown, isFatal: boolean): void | Promise<void> => {
      if (!this._autocaptureEnabled || isPostHogFetchNetworkError(error)) {
        return
      }
      const hint: CoreErrorTracking.EventHint = {
        mechanism: { type: 'onuncaughtexception', handled: false },
      }
      if (!isFatal) {
        this.instance.captureException(error, {}, hint)
        return
      }
      return this.handleFatalException(error, hint, uuidv7(), new Date())
    }
    try {
      this._unsubscribeUncaughtExceptions = trackUncaughtExceptions(onUncaughtException)
    } catch (err) {
      this.logger.warn('Failed to track uncaught exceptions: ', err)
    }
  }

  private async handleFatalException(
    error: unknown,
    hint: CoreErrorTracking.EventHint,
    eventUuid: string,
    timestamp: Date
  ): Promise<void> {
    let storageReady = !this.fatalCaptureHooks
    if (this.fatalCaptureHooks) {
      try {
        storageReady = (await this.fatalCaptureHooks.waitForStorageReady()) === true
      } catch (e) {
        this.logger.warn('Fatal capture skipped because events storage did not initialize.', e)
      }
    }
    // Unknown consent must fail closed. A crash is less important than persisting data
    // for a user whose opt-out state could not be loaded.
    if (!storageReady || !this._autocaptureEnabled || this.instance.isDisabled || this.instance.optedOut) {
      return
    }

    if (!this.fatalCaptureHooks) {
      this.instance.captureException(error, { $exception_level: 'fatal' as CoreErrorTracking.SeverityLevel }, hint)
      return
    }

    // Hand the final payload to the native SDK. Both native SDKs recognise a `$exception`
    // with `$exception_level: 'fatal'` and write it to their own disk queue synchronously
    // before returning, which is the durability the JS queue cannot promise while
    // AsyncStorage is still draining. Native owns delivery from there, including retry
    // across the relaunch, so there is nothing for the next launch to recover — and the JS
    // queue copy is dropped so the exception is not sent twice.
    let result: { queued: boolean; nativeCapture?: () => Promise<void> }
    try {
      result = this.fatalCaptureHooks.captureFatalException(error, hint, eventUuid, timestamp, (queued) =>
        this.prepareFatalNativeCapture(queued)
      )
    } catch (e) {
      // Without the final queued event we cannot know whether before_send accepted or
      // redacted the exception, so sending a raw fallback would bypass filtering.
      this.logger.error('Fatal exception capture failed before enqueue.', e)
      return
    }
    const { queued, nativeCapture } = result
    if (!queued && !nativeCapture) {
      // before_send dropped it.
      return
    }

    void this.instance.flush().catch(() => {
      this.logger.critical('Failed to flush events')
    })
    // Other events may still be queued behind this one, so the JS store is still worth
    // draining even when native owns the exception itself.
    const persisted = this.fatalCaptureHooks.waitForJSPersist()
    let nativeWrite: Promise<void> | undefined
    if (nativeCapture) {
      try {
        nativeWrite = nativeCapture().catch((e) => {
          this.logger.warn(`Fatal exception native capture failed: ${e}`)
        })
      } catch (e) {
        this.logger.warn(`Fatal exception native capture failed: ${e}`)
      }
    }
    const [persistedOk] = await Promise.all([persisted, nativeWrite])
    if (!persistedOk && !nativeCapture) {
      this.logger.warn('Fatal exception JS persist failed and no native capture path was available.')
    }
  }

  private prepareFatalNativeCapture(queuedEvent: PostHogEventProperties): (() => Promise<void>) | undefined {
    const bridge = OptionalReactNativePlugin?.captureFatalException
    if (!bridge) {
      return undefined
    }
    // Handing the event to a native SDK that is not set up yet would drop it: native
    // no-ops the capture, and the JS queue copy has already been given up.
    if (!this.fatalCaptureHooks?.isNativeCaptureReady()) {
      return undefined
    }
    // Memory-persistence apps asked for nothing on disk. The native queue is disk-backed,
    // so honour that here rather than routing around it.
    if (this.fatalCaptureHooks?.getPersistenceMode() === 'memory') {
      return undefined
    }
    if (this.instance.isDisabled || this.instance.optedOut) {
      return undefined
    }

    const properties = isObject(queuedEvent.properties) ? (queuedEvent.properties as PostHogEventProperties) : {}
    const payload = buildFatalExceptionPayload({
      timestamp: isString(queuedEvent.timestamp) ? queuedEvent.timestamp : new Date().toISOString(),
      distinctId: isString(queuedEvent.distinct_id) ? queuedEvent.distinct_id : '',
      // The event was normalized and emitted only after before_send accepted it.
      properties,
    })
    return () => bridge(payload.distinctId, payload.timestamp, payload.properties)
  }

  private autocaptureUnhandledRejections() {
    const onUnhandledRejection = (error: unknown) => {
      // Gate on remote config — if remotely disabled, don't capture
      if (!this._autocaptureEnabled) {
        return
      }

      // Offline/timeout failures are expected, not application errors.
      if (isPostHogFetchNetworkError(error)) {
        return
      }

      const hint: CoreErrorTracking.EventHint = {
        mechanism: {
          type: 'onunhandledrejection',
          handled: false,
        },
      }
      this.instance.captureException(error, {}, hint)
    }

    try {
      trackUnhandledRejections(onUnhandledRejection)
    } catch (err) {
      this.logger.warn('Failed to track unhandled rejections: ', err)
    }
  }

  private autocaptureConsole(levels: LogLevel[]) {
    const onConsole = (level: LogLevel) => (error: unknown, isFatal: boolean, syntheticException?: Error) => {
      // Gate on remote config — if remotely disabled, don't capture
      if (!this._autocaptureEnabled) {
        return
      }

      const hint: CoreErrorTracking.EventHint = {
        mechanism: {
          type: 'onconsole',
          handled: true,
        },
        syntheticException,
      }
      const additionalProperties = {
        $exception_level: level as CoreErrorTracking.SeverityLevel,
      }
      this.instance.captureException(error, additionalProperties, hint)
    }

    try {
      for (const level of levels) {
        trackConsole(level, onConsole(level))
      }
    } catch (err) {
      this.logger.warn('Failed to track console errors: ', err)
    }
  }

  private autocapture(autocaptureOptions: ResolvedAutocaptureOptions) {
    if (autocaptureOptions.uncaughtExceptions === true) {
      this.autocaptureUncaughtErrors()
    }
    if (autocaptureOptions.unhandledRejections === true) {
      this.autocaptureUnhandledRejections()
    }
    if (autocaptureOptions.console.length > 0) {
      this.autocaptureConsole(autocaptureOptions.console)
    }
  }
}
