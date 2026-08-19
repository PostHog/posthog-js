import { isError } from '@/utils/type-utils'
import { CoercingContext, ErrorTrackingCoercer, ExceptionLike } from '../types'

export class ErrorCoercer implements ErrorTrackingCoercer<Error> {
  match(err: unknown): err is Error {
    return isError(err)
  }

  coerce(err: Error, ctx: CoercingContext): ExceptionLike {
    const stack = this.getStack(err)
    // Some errors carry no usable stack (for example a Firefox network `fetch`
    // `TypeError`). Fall back to the synthetic exception captured at the call
    // site so the frames still point at the caller. Mark it synthetic so the
    // parser trims the SDK's own frames.
    const synthetic = stack === undefined
    return {
      type: this.getType(err),
      value: this.getMessage(err, ctx),
      stack: stack ?? ctx.syntheticException?.stack,
      cause: err.cause ? ctx.next(err.cause) : undefined,
      synthetic,
    }
  }

  private getType(err: Error): string {
    return err.name || err.constructor.name
  }

  private getMessage(err: Error & { message: { error?: Error } }, _ctx: CoercingContext): string {
    const message = err.message

    if (message.error && typeof message.error.message === 'string') {
      return String(message.error.message)
    }

    return String(message)
  }

  private getStack(err: Error & { stacktrace?: string }): string | undefined {
    return err.stacktrace || err.stack || undefined
  }
}
