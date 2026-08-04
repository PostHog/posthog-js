import { CoercingContext, ErrorTrackingCoercer, ExceptionLike } from '../types'
import { isErrorEvent, isString } from '@/utils'

// Structural subset of the DOM `ErrorEvent`. Avoids leaking a DOM-only global
// into the public type surface so non-DOM consumers (e.g. React Native, whose
// tsconfig lib excludes DOM) can still consume `@posthog/core` types via tools
// like api-extractor that resolve symbols transitively.
interface ErrorEventLike {
  message: string
  error?: unknown
}

interface ErrorEventLocation {
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
    return errorEvent.error != undefined || this._hasUsableMessage(errorEvent)
  }

  coerce(err: ErrorEventLike, ctx: CoercingContext): ExceptionLike {
    if (err.error != undefined) {
      return ctx.apply(err.error)
    }

    const exceptionLike = ctx.apply(err.message)
    return {
      ...exceptionLike,
      stack: this._buildLocationStack(err) ?? exceptionLike.stack,
      synthetic: true,
    }
  }

  private _hasUsableMessage(err: ErrorEventLike): boolean {
    return isString(err.message) && err.message.length > 0
  }

  private _buildLocationStack(err: ErrorEventLike): string | undefined {
    const location = err as ErrorEventLike & ErrorEventLocation
    if (isString(location.filename) && location.filename.length > 0) {
      const lineno = location.lineno ?? 0
      const colno = location.colno ?? 0
      // The message stays in `value`, which prevents multiline messages from being parsed as extra frames.
      return `Error\n    at ${location.filename}:${lineno}:${colno}`
    }
    return undefined
  }
}
