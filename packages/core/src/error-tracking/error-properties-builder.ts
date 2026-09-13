import { isArray, isError } from '@/utils'
import { getFilenameToChunkIdMap } from './chunk-ids'
import {
  ErrorProperties,
  ExceptionLike,
  ExceptionList,
  CoercingContext,
  StackFrame,
  StackFrameModifierFn,
  StackParser,
  ErrorTrackingCoercer,
  EventHint,
  ParsingContext,
  ChunkIdMapType,
  Mechanism,
  ParsedException,
  Exception,
} from './types'

const MAX_CAUSE_RECURSION = 4
// Count visits, including cyclic members, rather than only emitted exceptions.
const MAX_AGGREGATE_VISITS = 100

// Internal collections only: the event remains a flat ExceptionList.
interface ExceptionWithChildren extends ExceptionLike {
  errors?: ExceptionWithChildren[]
}

interface ParsedExceptionWithChildren extends ParsedException {
  errors?: ParsedExceptionWithChildren[]
}

export class ErrorPropertiesBuilder {
  constructor(
    private coercers: ErrorTrackingCoercer<any>[],
    private stackParser: StackParser,
    private modifiers: StackFrameModifierFn[] = []
  ) {}

  buildFromUnknown(input: unknown, hint: EventHint = {}): ErrorProperties {
    const providedMechanism = hint && hint.mechanism
    const mechanism = providedMechanism || {
      handled: true,
      type: 'generic',
    }
    const coercingContext: CoercingContext = this.buildCoercingContext(mechanism, hint, 0)
    const exceptionWithCause = coercingContext.apply(input)
    const parsingContext: ParsingContext = this.buildParsingContext(hint)
    const exceptionWithStack = this.parseStacktrace(exceptionWithCause, parsingContext)
    const exceptionList = this.convertToExceptionList(exceptionWithStack, mechanism)
    return {
      $exception_list: exceptionList,
      $exception_level: 'error',
    }
  }

  async modifyFrames(exceptionList: ErrorProperties['$exception_list']): Promise<ErrorProperties['$exception_list']> {
    for (const exc of exceptionList) {
      if (exc.stacktrace && exc.stacktrace.frames && isArray(exc.stacktrace.frames)) {
        exc.stacktrace.frames = await this.applyModifiers(exc.stacktrace.frames)
      }
    }
    return exceptionList
  }

  private coerceFallback(ctx: CoercingContext): ExceptionLike {
    return {
      type: 'Error',
      value: 'Unknown error',
      stack: ctx.syntheticException?.stack,
      synthetic: true,
    }
  }

  private parseStacktrace(err: ExceptionWithChildren, ctx: ParsingContext): ParsedExceptionWithChildren {
    let cause: ParsedException | undefined = undefined
    if (err.cause != null) {
      cause = this.parseStacktrace(err.cause, ctx)
    }
    let stack: StackFrame[] | undefined = undefined
    if (err.stack != '' && err.stack != null) {
      stack = this.applyChunkIds(this.stackParser(err.stack, err.synthetic ? ctx.skipFirstLines : 0), ctx.chunkIdMap)
    }
    return { ...err, cause, stack, errors: err.errors?.map((child) => this.parseStacktrace(child, ctx)) }
  }

  private applyChunkIds(frames: StackFrame[], chunkIdMap?: ChunkIdMapType): StackFrame[] {
    return frames.map((frame) => {
      if (frame.filename && chunkIdMap) {
        frame.chunk_id = chunkIdMap[frame.filename]
      }
      return frame
    })
  }

  private applyCoercers(input: unknown, ctx: CoercingContext): ExceptionLike | undefined {
    for (const adapter of this.coercers) {
      if (adapter.match(input)) {
        return adapter.coerce(input, ctx)
      }
    }
    return this.coerceFallback(ctx)
  }

  private async applyModifiers(frames: StackFrame[]): Promise<StackFrame[]> {
    let newFrames = frames
    for (const modifier of this.modifiers) {
      newFrames = await modifier(newFrames)
    }
    return newFrames
  }

  private convertToExceptionList(exceptionWithStack: ParsedExceptionWithChildren, mechanism: Mechanism): ExceptionList {
    const currentException: Exception = {
      type: exceptionWithStack.type,
      value: exceptionWithStack.value,
      mechanism: {
        type: mechanism.type ?? 'generic',
        handled: mechanism.handled ?? true,
        synthetic: exceptionWithStack.synthetic ?? false,
      },
    }
    if (exceptionWithStack.stack) {
      currentException.stacktrace = {
        type: 'raw',
        frames: exceptionWithStack.stack,
      }
    }
    const exceptionList: ExceptionList = [currentException]
    if (exceptionWithStack.cause != null) {
      // Cause errors are necessarily handled
      exceptionList.push(
        ...this.convertToExceptionList(exceptionWithStack.cause, {
          ...mechanism,
          handled: true,
        })
      )
    }
    // Aggregate members have already been caught and combined, like cause errors.
    // Keep them separate internally and append them after the ordinary cause chain.
    for (const child of exceptionWithStack.errors ?? []) {
      exceptionList.push(...this.convertToExceptionList(child, { ...mechanism, handled: true }))
    }
    return exceptionList
  }

  private buildParsingContext(hint: EventHint): ParsingContext {
    const context: ParsingContext = {
      chunkIdMap: getFilenameToChunkIdMap(this.stackParser),
      skipFirstLines: hint.skipFirstLines ?? 1,
    }
    return context
  }

  private getAggregateErrors(input: unknown): unknown[] | undefined {
    try {
      if (isError(input)) {
        const errors = (input as Error & { errors?: unknown }).errors
        return isArray(errors) ? errors : undefined
      }
    } catch {
      // A malformed errors accessor must not discard the root exception.
    }
    return undefined
  }

  public buildCoercingContext(mechanism: Mechanism, hint: EventHint, depth: number = 0): CoercingContext {
    let visits = 0
    let hasAggregate = false
    const ancestors: unknown[] = []
    const coerce = (input: unknown, depth: number): ExceptionWithChildren | undefined => {
      if (depth > MAX_CAUSE_RECURSION || (hasAggregate && visits >= MAX_AGGREGATE_VISITS)) {
        return undefined
      }
      visits++
      const errors = this.getAggregateErrors(input)
      hasAggregate ||= !!errors
      // Ordinary cause-only errors retain their existing depth-limited behavior.
      // Track the current path, not all seen errors, so shared siblings are retained.
      if (hasAggregate && ancestors.indexOf(input) !== -1) {
        return undefined
      }
      const ctx = createContext(depth)
      ancestors.push(input)
      try {
        const exception = this.applyCoercers(input, ctx)
        if (!exception || !errors || depth === MAX_CAUSE_RECURSION) {
          return exception
        }
        const children: ExceptionWithChildren[] = []
        for (let index = 0; visits < MAX_AGGREGATE_VISITS && index < errors.length; index++) {
          let child: ExceptionWithChildren | undefined
          try {
            child = ctx.next(errors[index])
          } catch {
            // Unreadable members use the same fallback as unsupported inputs.
            visits++
            child = this.coerceFallback(createContext(depth + 1))
          }
          if (child) {
            children.push(child)
          }
        }
        return { ...exception, errors: children }
      } catch (error) {
        if (!hasAggregate) {
          throw error
        }
        return this.coerceFallback(ctx)
      } finally {
        ancestors.pop()
      }
    }
    const createContext = (depth: number): CoercingContext => ({
      ...hint,
      // Do not propagate synthetic exception as it doesn't make sense
      syntheticException: depth == 0 ? hint.syntheticException : undefined,
      mechanism,
      apply: (input: unknown) => coerce(input, depth) ?? this.coerceFallback(createContext(depth)),
      next: (input: unknown) => coerce(input, depth + 1),
    })
    return createContext(depth)
  }
}
