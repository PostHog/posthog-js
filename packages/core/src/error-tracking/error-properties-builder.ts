import { isArray } from '@/utils'
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

const MAX_EXCEPTION_ENTRIES = 50
const RESERVED_EXCEPTION_PROPERTIES = new Set([
  '$exception_list',
  '$exception_level',
  '$exception_source',
  '$debug_images',
  '$exception_handled',
  '$exception_types',
  '$exception_values',
  '$exception_sources',
  '$exception_functions',
  '$exception_fingerprint_version',
  '$exception_fingerprint_record',
  '$exception_issue_id',
  '$exception_release',
  '$cymbal_errors',
])

export function sanitizeAdditionalExceptionProperties(
  properties?: Record<string | number, any>
): Record<string | number, any> {
  if (!properties) {
    return {}
  }
  return Object.fromEntries(Object.entries(properties).filter(([key]) => !RESERVED_EXCEPTION_PROPERTIES.has(key)))
}

const SEVERITY_ALIASES: Record<string, ErrorProperties['$exception_level']> = {
  fatal: 'fatal',
  critical: 'fatal',
  alert: 'fatal',
  emergency: 'fatal',
  error: 'error',
  warning: 'warning',
  warn: 'warning',
  log: 'log',
  notice: 'info',
  info: 'info',
  trace: 'debug',
  debug: 'debug',
}

export function normalizeExceptionLevel(level: unknown): ErrorProperties['$exception_level'] | undefined {
  return typeof level === 'string' ? SEVERITY_ALIASES[level.toLowerCase()] : undefined
}

export class ErrorPropertiesBuilder {
  constructor(
    private coercers: ErrorTrackingCoercer<any>[],
    private stackParser: StackParser,
    private modifiers: StackFrameModifierFn[] = []
  ) {}

  buildFromUnknown(input: unknown, hint: EventHint = {}): ErrorProperties {
    const mechanism = this.resolveOutermostMechanism(hint.mechanism)
    const coercingContext: CoercingContext = this.buildCoercingContext(mechanism, hint, 0, new WeakSet())
    const exceptionWithCause = coercingContext.apply(input)
    const parsingContext: ParsingContext = this.buildParsingContext(hint)
    const exceptionWithStack = this.parseStacktrace(exceptionWithCause, parsingContext)
    const exceptionList = this.convertToExceptionList(exceptionWithStack, mechanism, 0, undefined, { value: 0 })
    const properties: ErrorProperties = {
      $exception_list: exceptionList,
      $exception_level: normalizeExceptionLevel(hint.level) ?? 'error',
    }
    if (typeof hint.source === 'string' && hint.source.length > 0) {
      properties.$exception_source = hint.source
    }
    return properties
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

  private parseStacktrace(err: ExceptionLike, ctx: ParsingContext): ParsedException {
    let cause: ParsedException | undefined = undefined
    if (err.cause != null) {
      cause = this.parseStacktrace(err.cause, ctx)
    }
    let stack: StackFrame[] | undefined = undefined
    if (err.stack != '' && err.stack != null) {
      stack = this.applyChunkIds(this.stackParser(err.stack, err.synthetic ? ctx.skipFirstLines : 0), ctx.chunkIdMap)
    }
    return { ...err, cause, stack }
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

  private convertToExceptionList(
    exceptionWithStack: ParsedException,
    mechanism: Mechanism,
    exceptionId: number,
    parentId: number | undefined,
    nextId: { value: number }
  ): ExceptionList {
    const isNested = parentId !== undefined
    const resolvedMechanism: Mechanism = isNested
      ? {
          type: 'chained',
          source: 'cause',
          synthetic: exceptionWithStack.synthetic,
          exception_id: exceptionId,
          parent_id: parentId,
        }
      : {
          ...mechanism,
          synthetic: exceptionWithStack.synthetic,
          exception_id: exceptionId,
        }
    const currentException: Exception = {
      type: exceptionWithStack.type,
      value: exceptionWithStack.value,
      mechanism: resolvedMechanism,
    }
    if (exceptionWithStack.stack) {
      currentException.stacktrace = {
        type: 'raw',
        frames: exceptionWithStack.stack,
      }
    }
    const exceptionList: ExceptionList = [currentException]
    if (exceptionWithStack.cause != null && nextId.value + 1 < MAX_EXCEPTION_ENTRIES) {
      const childId = ++nextId.value
      exceptionList.push(
        ...this.convertToExceptionList(exceptionWithStack.cause, mechanism, childId, exceptionId, nextId)
      )
    }
    return exceptionList
  }

  private resolveOutermostMechanism(provided?: Partial<Mechanism>): Mechanism {
    const mechanism: Mechanism = {}
    if (provided) {
      for (const [key, value] of Object.entries(provided)) {
        if (!['type', 'handled', 'source', 'synthetic', 'exception_id', 'parent_id'].includes(key)) {
          mechanism[key] = value
        }
      }
    }

    mechanism.type = typeof provided?.type === 'string' && provided.type.length > 0 ? provided.type : 'generic'
    mechanism.handled = typeof provided?.handled === 'boolean' ? provided.handled : true
    return mechanism
  }

  private buildParsingContext(hint: EventHint): ParsingContext {
    const context: ParsingContext = {
      chunkIdMap: getFilenameToChunkIdMap(this.stackParser),
      skipFirstLines: hint.skipFirstLines ?? 1,
    }
    return context
  }

  public buildCoercingContext(
    mechanism: Mechanism,
    hint: EventHint,
    depth: number = 0,
    seen: WeakSet<object> = new WeakSet()
  ): CoercingContext {
    const coerce = (input: unknown, depth: number) => {
      if (depth < MAX_EXCEPTION_ENTRIES) {
        if ((typeof input === 'object' && input !== null) || typeof input === 'function') {
          if (seen.has(input)) {
            return undefined
          }
          seen.add(input)
        }
        const ctx = this.buildCoercingContext(mechanism, hint, depth, seen)
        return this.applyCoercers(input, ctx)
      } else {
        return undefined
      }
    }
    const context: CoercingContext = {
      ...hint,
      // Do not propagate synthetic exception as it doesn't make sense
      syntheticException: depth == 0 ? hint.syntheticException : undefined,
      mechanism,
      // `coerce` only widens to `undefined` past MAX_CAUSE_RECURSION; `apply` reuses this
      // context's depth, which was already validated when the context was built
      apply: (input: unknown) => {
        return coerce(input, depth) as ExceptionLike
      },
      next: (input: unknown) => {
        return coerce(input, depth + 1)
      },
    }
    return context
  }
}
