import type { PostHog } from '../posthog-rn'
import { Logger, PostHogEventProperties, ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { trackConsole, trackUncaughtExceptions, trackUnhandledRejections } from './utils'

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
  private errorPropertiesBuilder: CoreErrorTracking.ErrorPropertiesBuilder
  private logger: Logger
  private options: ResolvedErrorTrackingOptions

  constructor(
    private instance: PostHog,
    options: ErrorTrackingOptions = {},
    logger: Logger
  ) {
    this.errorPropertiesBuilder = new CoreErrorTracking.ErrorPropertiesBuilder(
      [
        new CoreErrorTracking.PromiseRejectionEventCoercer(),
        new CoreErrorTracking.ErrorCoercer(),
        new CoreErrorTracking.ErrorEventCoercer(),
        new CoreErrorTracking.ObjectCoercer(),
        new CoreErrorTracking.StringCoercer(),
        new CoreErrorTracking.PrimitiveCoercer(),
      ],
      CoreErrorTracking.createStackParser(
        'hermes',
        CoreErrorTracking.chromeStackLineParser,
        CoreErrorTracking.geckoStackLineParser
      )
    )
    this.logger = logger.createLogger('[ErrorTracking]')
    this.options = this.resolveOptions(options)
    this.autocapture(this.options.autocapture)
  }

  captureException(input: unknown, additionalProperties: PostHogEventProperties, hint: CoreErrorTracking.EventHint) {
    try {
      const properties = this.errorPropertiesBuilder.buildFromUnknown(input, hint)
      return this.instance.capture('$exception', {
        ...properties,
        ...additionalProperties,
      } as unknown as PostHogEventProperties)
    } catch (error) {
      this.logger.error('An error occurred while capturing an $exception event:', error)
    }
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

      this.captureException(error, additionalProperties, hint)

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
      const hint: CoreErrorTracking.EventHint = {
        mechanism: {
          type: 'onunhandledrejection',
          handled: false,
        },
      }
      this.captureException(error, {}, hint)
    }

    try {
      trackUnhandledRejections(onUnhandledRejection)
    } catch (err) {
      this.logger.warn('Failed to track unhandled rejections: ', err)
    }
  }

  private autocaptureConsole(levels: LogLevel[]) {
    const onConsole = (level: LogLevel) => (error: unknown, isFatal: boolean, syntheticException?: Error) => {
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
      this.captureException(error, additionalProperties, hint)
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
