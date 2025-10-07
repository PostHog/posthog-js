import {
  chromeStackLineParser,
  ErrorCoercer,
  ErrorPropertiesBuilder,
  EventHint,
  geckoStackLineParser,
  ObjectCoercer,
  PrimitiveCoercer,
  PromiseRejectionEventCoercer,
  SeverityLevel,
  StringCoercer,
} from '@posthog/core/error-tracking'
import type { PostHog } from '../posthog-rn'
import { PostHogEventProperties } from '@posthog/core'
import { isHermes } from '../utils'

interface AutocaptureOptions {
  uncaughtExceptions?: boolean
  unhandledRejections?: boolean
}

export interface ErrorTrackingOptions {
  autocapture?: AutocaptureOptions | boolean
}

export class ErrorTracking {
  errorPropertiesBuilder: ErrorPropertiesBuilder

  constructor(
    private instance: PostHog,
    options: ErrorTrackingOptions = {}
  ) {
    this.errorPropertiesBuilder = new ErrorPropertiesBuilder(
      [
        new PromiseRejectionEventCoercer(),
        new ErrorCoercer(),
        new ObjectCoercer(),
        new StringCoercer(),
        new PrimitiveCoercer(),
      ],
      [chromeStackLineParser, geckoStackLineParser]
    )
    const autocaptureOptions = this.resolveAutocaptureOptions(options.autocapture)
    this.autocapture(autocaptureOptions)
  }

  captureException(input: unknown, additionalProperties: PostHogEventProperties, hint: EventHint) {
    const properties = this.errorPropertiesBuilder.buildFromUnknown(input, hint)
    return this.instance.capture('$exception', {
      ...properties,
      ...additionalProperties,
    } as unknown as PostHogEventProperties)
  }

  private resolveAutocaptureOptions(autocapture: AutocaptureOptions | boolean = false): AutocaptureOptions {
    if (typeof autocapture === 'boolean') {
      return {
        uncaughtExceptions: autocapture,
        unhandledRejections: autocapture,
      }
    }
    return {
      uncaughtExceptions: !!autocapture.uncaughtExceptions,
      unhandledRejections: !!autocapture.unhandledRejections,
    }
  }

  private autocaptureUncaughtErrors() {
    const globalHandler = ErrorUtils.getGlobalHandler()
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      const hint: EventHint = {
        mechanism: {
          type: 'onuncaughtexception',
          handled: false,
        },
      }
      const additionalProperties: any = {}
      if (isFatal) {
        additionalProperties['$exception_level'] = 'fatal' as SeverityLevel
      }
      this.captureException(error, additionalProperties, hint)
      globalHandler?.(error, isFatal)
    })
  }

  private autocaptureUnhandledRejections() {
    const onUnhanledRejection = (error: unknown) => {
      const hint: EventHint = {
        mechanism: {
          type: 'onunhandledrejection',
          handled: false,
        },
      }
      this.captureException(error, {}, hint)
    }
    if (isHermes()) {
      // @ts-expect-error
      global.HermesInternal.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (_: any, error: any) => onUnhanledRejection(error),
      })
    } else {
      // javascript-core handling
      const tracking = require('promise/setimmediate/rejection-tracking')
      tracking.enable({
        allRejections: true,
        onUnhandled: (_: any, error: any) => onUnhanledRejection(error),
      })
    }
  }

  private autocapture(autocaptureOptions: AutocaptureOptions = {}) {
    if (autocaptureOptions.uncaughtExceptions == true) {
      this.autocaptureUncaughtErrors()
    }
    if (autocaptureOptions.unhandledRejections == true) {
      this.autocaptureUnhandledRejections()
    }
  }
}
