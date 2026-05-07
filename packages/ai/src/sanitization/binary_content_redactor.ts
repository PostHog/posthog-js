import { Base64Recognizer } from './base64_recognizer'
import { MediaTypeContext } from './media_type_context'

const STRONG_CONTEXT_MIN_LENGTH = 64
const WEAK_CONTEXT_MIN_LENGTH = 1024

export class BinaryContentRedactor {
  private visited: WeakSet<object> = new WeakSet()

  constructor(private readonly recognizer: Base64Recognizer = new Base64Recognizer()) {}

  redact<T>(value: T): T
  redact(value: unknown): unknown {
    if (this.isMultimodalEnabled()) return value
    this.visited = new WeakSet()
    return this.walk(value, MediaTypeContext.EMPTY)
  }

  private walk(value: unknown, ctx: MediaTypeContext): unknown {
    if (value === null || value === undefined) return value
    if (typeof value === 'string') return this.redactString(value, ctx)
    if (typeof value !== 'object') return value

    // Buffer extends Uint8Array, so this branch catches both.
    if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) {
      return this.placeholderFor(ctx.inferMediaType())
    }

    if (this.visited.has(value)) return null
    this.visited.add(value)

    if (Array.isArray(value)) {
      return value.map((item) => this.walk(item, ctx))
    }

    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) {
      out[k] = this.walk(obj[k], new MediaTypeContext(obj, k))
    }
    return out
  }

  private redactString(value: string, ctx: MediaTypeContext): string {
    const minLength = ctx.signalsBinary() ? STRONG_CONTEXT_MIN_LENGTH : WEAK_CONTEXT_MIN_LENGTH
    const recognition = this.recognizer.recognize(value, minLength)
    switch (recognition.kind) {
      case 'data-url':
        return this.placeholderFor(recognition.mediaType)
      case 'raw':
        return this.placeholderFor(ctx.inferMediaType())
      case 'none':
        return value
    }
  }

  private placeholderFor(mediaType?: string): string {
    if (!mediaType) return '[base64 redacted]'
    if (mediaType === 'application/octet-stream') return '[base64 file redacted]'
    return `[base64 ${mediaType} redacted]`
  }

  private isMultimodalEnabled(): boolean {
    const val = process.env._INTERNAL_LLMA_MULTIMODAL || ''
    return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes'
  }
}
