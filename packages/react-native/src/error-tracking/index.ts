import type { PostHog } from '../posthog-rn'
import { JsonType, Logger, ErrorTracking as CoreErrorTracking, isPostHogFetchNetworkError } from '@posthog/core'
import { trackConsole, trackUncaughtExceptions, trackUnhandledRejections } from './utils'
import { getRemoteConfigBool } from '../utils'

type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error'

const LogLevelList: LogLevel[] = ['debug', 'log', 'info', 'warn', 'error']

// user provided configuration
interface AutocaptureOptions {
  uncaughtExceptions?: boolean
  unhandledRejections?: boolean
  console?: boolean | LogLevel[]
}

export interface ErrorTrackingOptions {
  autocapture?: AutocaptureOptions | boolean
  /**
   * Enables native iOS/Android error autocapture through the optional native plugin.
   * Disabled by default. Requires `@posthog/react-native-plugin` installed.
   */
  autocaptureNative?: boolean
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
    this.autocapture(this.options.autocapture)
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
