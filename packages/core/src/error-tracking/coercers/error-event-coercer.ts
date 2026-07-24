import { CoercingContext, ErrorTrackingCoercer, ExceptionLike } from '../types'
import { isErrorEvent, isString } from '@/utils'

// Structural subset of the DOM `ErrorEvent`. Avoids leaking a DOM-only global
// into the public type surface so non-DOM consumers (e.g. React Native, whose
// tsconfig lib excludes DOM) can still consume `@posthog/core` types via tools
// like api-extractor that resolve symbols transitively.
interface ErrorEventLike {
  message: string
  error?: unknown
  filename?: string
  lineno?: number
  colno?: number
}

export class ErrorEventCoercer implements ErrorTrackingCoercer<ErrorEventLike> {
  constructor() {}

  match(err: unknown): err is ErrorEventLike {
    if (!isErrorEvent(err)) {
      return false
    }
    const errorEvent = err as ErrorEventLike
    // Match when the event carries a real Error to unwrap, or at least a usable
    // message we can salvage. Bare ErrorEvents with neither fall through to the
    // later EventCoercer.
    return errorEvent.error != undefined || this._hasUsableMessage(errorEvent)
  }

  coerce(err: ErrorEventLike, ctx: CoercingContext): ExceptionLike {
    if (err.error != undefined) {
      const exceptionLike = ctx.apply(err.error)
      if (exceptionLike) {
        return exceptionLike
      }
    }
    // No unwrappable Error object (e.g. a cross-origin "Script error.", or a
    // browser that populated the message but not the `error` property). Rather
    // than let this fall through to the EventCoercer — which would render it as
    // junk like "ErrorEvent captured as exception with keys: ..." — salvage the
    // message and synthesize a frame from the event's location.
    return {
      type: 'Error',
      value: err.message,
      stack: this._buildStack(err, ctx),
      synthetic: true,
    }
  }

  private _hasUsableMessage(err: ErrorEventLike): boolean {
    return isString(err.message) && err.message.length > 0
  }

  private _buildStack(err: ErrorEventLike, ctx: CoercingContext): string | undefined {
    // `onerror` gives us filename/lineno/colno even when it has no Error object.
    // Encode them as a single synthetic frame so error tracking can show where
    // the error came from (and resolve it via source maps). The chrome stack
    // parser reads lines shaped like `    at <filename>:<lineno>:<colno>`.
    if (isString(err.filename) && err.filename.length > 0) {
      const lineno = err.lineno ?? 0
      const colno = err.colno ?? 0
      return `Error: ${err.message}\n    at ${err.filename}:${lineno}:${colno}`
    }
    return ctx.syntheticException?.stack
  }
}
