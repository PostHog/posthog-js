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

const MAX_EXCEPTIONS = 50
const MAX_AGGREGATE_MEMBER_INSPECTIONS = 1000
// Forwarding wrappers do not represent tree edges or consume exception slots.
const MAX_WRAPPER_RECURSION = 4

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
    const exceptionList: ExceptionList = []
    const append = (exception: ParsedExceptionWithChildren, parentId?: number, source?: string): void => {
      const exceptionId = exceptionList.length
      const entryMechanism: Mechanism =
        parentId === undefined
          ? {
              type: typeof mechanism.type === 'string' && mechanism.type.length > 0 ? mechanism.type : 'generic',
              handled: typeof mechanism.handled === 'boolean' ? mechanism.handled : true,
              synthetic: typeof mechanism.synthetic === 'boolean' ? mechanism.synthetic : exception.synthetic,
              exception_id: exceptionId,
            }
          : {
              type: 'chained',
              source,
              synthetic: exception.synthetic,
              exception_id: exceptionId,
              parent_id: parentId,
            }
      const currentException: Exception = {
        type: exception.type,
        value: exception.value,
        mechanism: entryMechanism,
      }
      if (exception.stack) {
        currentException.stacktrace = { type: 'raw', frames: exception.stack }
      }
      exceptionList.push(currentException)
      if (exception.cause) {
        append(exception.cause, exceptionId, 'cause')
      }
      for (const child of exception.errors ?? []) {
        append(child, exceptionId, 'member')
      }
    }
    append(exceptionWithStack)
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
    let count = 0
    let memberInspections = 0
    let hasAggregate = false
    const seen = new Set<unknown>()
    const wrappers: unknown[] = []
    const skipped = {}
    const coerce = (input: unknown, depth: number, wrapperDepth = 0): ExceptionWithChildren | undefined => {
      const ctx = createContext(depth, wrapperDepth)
      const forward = ctx.apply
      ctx.apply = (nextInput) => {
        wrappers.push(input)
        try {
          return forward(nextInput)
        } finally {
          wrappers.pop()
        }
      }
      if (wrapperDepth > MAX_WRAPPER_RECURSION || (wrapperDepth > 0 && wrappers.indexOf(input) !== -1)) {
        return this.coerceFallback(ctx)
      }
      const isReference = (typeof input === 'object' && input !== null) || typeof input === 'function'
      if ((wrapperDepth === 0 && count >= MAX_EXCEPTIONS) || (isReference && seen.has(input))) {
        return undefined
      }
      if (isReference) {
        seen.add(input)
      }
      if (wrapperDepth === 0) {
        count++
      }
      const errors = this.getAggregateErrors(input)
      hasAggregate ||= !!errors
      try {
        const exception = this.applyCoercers(input, ctx)
        if (!exception) {
          throw skipped
        }
        if (!errors || count >= MAX_EXCEPTIONS) {
          return exception
        }
        // Snapshot finite array length. A separate inspection budget bounds duplicate
        // and cyclic members, which can truncate pathological inputs before 50 entries.
        let length: number
        try {
          length = errors.length
        } catch {
          return exception
        }
        if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) {
          return exception
        }
        const children: ExceptionWithChildren[] = []
        for (
          let index = 0;
          count < MAX_EXCEPTIONS && memberInspections < MAX_AGGREGATE_MEMBER_INSPECTIONS && index < length;
          index++
        ) {
          memberInspections++
          let child: ExceptionWithChildren | undefined
          try {
            child = ctx.next(errors[index])
          } catch {
            count++
            child = this.coerceFallback(createContext(depth + 1))
          }
          if (child) {
            children.push(child)
          }
        }
        return { ...exception, errors: children }
      } catch (error) {
        if (error === skipped) {
          if (wrapperDepth === 0) {
            count--
          }
          return undefined
        }
        if (!hasAggregate) {
          throw error
        }
        return this.coerceFallback(ctx)
      }
    }
    const createContext = (depth: number, wrapperDepth = 0): CoercingContext => ({
      ...hint,
      // Capture-boundary metadata and replacement stacks belong only to the root.
      syntheticException: depth == 0 ? hint.syntheticException : undefined,
      mechanism: depth == 0 ? mechanism : {},
      apply: (input: unknown) => {
        const exception = coerce(input, depth, wrapperDepth + 1)
        if (!exception) {
          throw skipped
        }
        return exception
      },
      next: (input: unknown) => coerce(input, depth + 1),
    })
    const context = createContext(depth)
    return { ...context, apply: (input) => coerce(input, depth) ?? this.coerceFallback(context) }
  }
}
