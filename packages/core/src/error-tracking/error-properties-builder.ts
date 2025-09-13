import { getFilenameToChunkIdMap } from './chunk-ids'
import { createStackParser } from './parsers'
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
  StackLineParser,
  ParsingContext,
  ChunkIdMapType,
  Mechanism,
  ParsedException,
} from './types'

const MAX_CAUSE_RECURSION = 4

export class ErrorPropertiesBuilder {
  stackParser: StackParser

  constructor(
    private coercers: ErrorTrackingCoercer<any>[] = [],
    parsers: StackLineParser[] = [],
    private modifiers: StackFrameModifierFn[] = []
  ) {
    this.stackParser = createStackParser(...parsers)
  }

  buildFromUnknown(input: unknown, hint: EventHint): ErrorProperties {
    const providedMechanism = hint && hint.mechanism
    const mechanism = providedMechanism || {
      handled: true,
      type: 'generic',
    }
    const coercingContext: CoercingContext = this.buildCoercingContext(mechanism, hint, 0)
    const exceptionWithCause = coercingContext.coerceUnknown(input) ?? this.coerceFallback(coercingContext)
    const parsingContext: ParsingContext = this.buildParsingContext()
    const exceptionWithStack = this.parseStacktrace(exceptionWithCause, parsingContext)
    const exceptionList = this.convertToExceptionList(exceptionWithStack, mechanism)
    return {
      $exception_list: exceptionList,
      $exception_level: 'error',
    }
  }

  coerceFallback(ctx: CoercingContext): ExceptionLike {
    return {
      type: 'Error',
      value: 'Unknown error',
      stack: ctx.syntheticException?.stack,
      synthetic: true,
    }
  }

  parseStacktrace(err: ExceptionLike, ctx: ParsingContext): ParsedException {
    let cause: ParsedException | undefined = undefined
    if (err.cause != null) {
      cause = this.parseStacktrace(err.cause, ctx)
    }
    let stack: StackFrame[] | undefined = undefined
    if (err.stack != null) {
      stack = this.applyChunkIds(this.stackParser(err.stack, err.synthetic ? 1 : 0), ctx.chunkIdMap)
    }
    return { ...err, cause, stack }
  }

  private applyChunkIds(frames: StackFrame[], chunkIdMap?: ChunkIdMapType): StackFrame[] {
    return frames.map((frame) => ({
      ...frame,
      chunk_id: frame.filename && chunkIdMap ? chunkIdMap[frame.filename] : undefined,
    }))
  }

  private applyCoercers(input: unknown, ctx: CoercingContext): ExceptionLike | undefined {
    for (const adapter of this.coercers) {
      if (adapter.match(input)) {
        return adapter.coerce(input, ctx)
      }
    }
    return undefined
  }

  private async applyModifiers(frames: StackFrame[]): Promise<StackFrame[]> {
    let newFrames = frames
    for (const modifier of this.modifiers) {
      newFrames = await modifier(newFrames)
    }
    return newFrames
  }

  private async modifyFrames(exceptionWithStack: ParsedException): Promise<ParsedException> {
    let cause: ParsedException | undefined = undefined
    if (exceptionWithStack.cause != null) {
      cause = await this.modifyFrames(exceptionWithStack.cause)
    }
    let stack: StackFrame[] | undefined = undefined
    if (exceptionWithStack.stack != null) {
      stack = await this.applyModifiers(exceptionWithStack.stack)
    }
    return { ...exceptionWithStack, cause, stack }
  }

  private convertToExceptionList(exceptionWithStack: ParsedException, mechanism: Mechanism): ExceptionList {
    const exceptionList: ExceptionList = []
    exceptionList.push({
      type: exceptionWithStack.type,
      value: exceptionWithStack.value,
      mechanism: {
        handled: mechanism.handled,
        synthetic: exceptionWithStack.synthetic,
      },
      stacktrace: {
        type: 'raw',
        frames: exceptionWithStack.stack,
      },
    })
    if (exceptionWithStack.cause != null) {
      exceptionList.push(...this.convertToExceptionList(exceptionWithStack.cause, mechanism))
    }
    return exceptionList
  }

  buildParsingContext(): ParsingContext {
    const context = {
      chunkIdMap: getFilenameToChunkIdMap(this.stackParser),
    } as ParsingContext
    return context
  }

  buildCoercingContext(mechanism: Mechanism, hint: EventHint, depth: number = 0): CoercingContext {
    const context = {
      ...hint,
      mechanism,
      maybeCoerceUnknown: (input?: unknown) => {
        if (input != null) {
          return context.coerceUnknown(input)
        } else {
          return undefined
        }
      },
      coerceUnknown: (input: unknown) => {
        if (depth <= MAX_CAUSE_RECURSION) {
          const ctx = this.buildCoercingContext(mechanism, hint, depth + 1)
          return this.applyCoercers(input, ctx)
        } else {
          return undefined
        }
      },
    } as CoercingContext
    return context
  }
}
