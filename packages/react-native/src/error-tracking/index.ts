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
} from '@posthog/core'
import { Properties } from '@posthog/types'
import { trackConsole, trackUncaughtExceptions, trackUnhandledRejections } from './utils'
import { getRemoteConfigBool } from '../utils'
import { OptionalReactNativePlugin } from '../optional/OptionalPlugin'

type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error'

const LogLevelList: LogLevel[] = ['debug', 'log', 'info', 'warn', 'error']

// user provided configuration
interface AutocaptureOptions {
  uncaughtExceptions?: boolean
  unhandledRejections?: boolean
  console?: boolean | LogLevel[]
  /**
   * Enables native iOS/Android/macOS crash autocapture through the optional native plugin.
   * Disabled by default. Requires `@posthog/react-native-plugin` installed (2.2.0 or newer for macOS).
   */
  nativeCrashes?: boolean
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

export class ErrorTracking {
  private logger: Logger
  private options: ResolvedErrorTrackingOptions
  private _exceptionStepsConfig: CoreErrorTracking.ResolvedExceptionStepsConfig
  private _exceptionStepsBuffer: CoreErrorTracking.ExceptionStepsBuffer
  private _nativeForwardingEnabled: boolean = false

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
    logger: Logger
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
    const onUncaughtException = (error: unknown, isFatal: boolean) => {
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
          type: 'onuncaughtexception',
          handled: false,
        },
      }
      const additionalProperties: any = {}

      if (isFatal) {
        additionalProperties['$exception_level'] = 'fatal' as CoreErrorTracking.SeverityLevel
      }

      this.instance.captureException(error, additionalProperties, hint)

      if (isFatal) {
        void this.instance.flush().catch(() => {
          this.logger.critical('Failed to flush events')
        })
      }
    }
    try {
      trackUncaughtExceptions(onUncaughtException)
    } catch (err) {
      this.logger.warn('Failed to track uncaught exceptions: ', err)
    }
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
