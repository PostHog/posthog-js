import { toJsonSafeValue } from '@posthog/core'
import { isFullAiCaptureEnabled, type FullAiCaptureGate } from './captureAiEvent'
import { BinaryContentRedactor } from './sanitization/binary_content_redactor'
import { MediaTypeContext } from './sanitization/media_type_context'
import { truncate } from './utils'

// Match toJsonSafeValue's structural safeguards. A separate visitor is needed
// here because JSON conversion erases the identity of supported binary values.
const MAX_DEPTH = 20
const MAX_ITEMS = 1_000
const MAX_NODES = 10_000
const TRUNCATED = '[Truncated]'
const UNSERIALIZABLE = '[Unserializable]'
const redactor = new BinaryContentRedactor()
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

/** @internal Preserve tool-result structure while bounding each string value. */
export function formatToolResult(content: unknown, client?: FullAiCaptureGate, maxBytes = 5000): unknown {
  try {
    // Full capture still has JSON traversal guards, but no content redaction or string cap.
    if (isFullAiCaptureEnabled(client)) return toJsonSafeValue(content)

    const ancestors = new WeakSet<object>()
    let remainingNodes = MAX_NODES
    const convert = (value: unknown, depth: number, context: MediaTypeContext): unknown => {
      if (remainingNodes <= 0) return TRUNCATED
      remainingNodes--
      try {
        if (value === null || typeof value !== 'object') {
          const safe = toJsonSafeValue(value)
          return typeof safe === 'string' ? truncate(redactor.redactLeaf(safe, context), undefined, maxBytes) : safe
        }
        if (depth >= MAX_DEPTH) return TRUNCATED

        // Buffer is a Uint8Array. Check before toJSON/ordinary object conversion,
        // so bytes cannot become an unrecognizable numeric object or JSON array.
        if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) {
          return redactor.redactLeaf(value, context)
        }
        if (ancestors.has(value)) return '[Circular]'
        ancestors.add(value)
        try {
          if (value instanceof Date) {
            const safe = toJsonSafeValue(value)
            return typeof safe === 'string' ? truncate(redactor.redactLeaf(safe, context), undefined, maxBytes) : safe
          }

          let hasToJSONResult = false
          let toJSONResult: unknown
          try {
            const toJSON = (value as { toJSON?: unknown }).toJSON
            if (typeof toJSON === 'function') {
              toJSONResult = toJSON.call(value)
              hasToJSONResult = true
            }
          } catch {
            // Match toJsonSafeValue: a broken toJSON falls back to own properties.
          }
          if (hasToJSONResult) return convert(toJSONResult, depth + 1, context)

          if (Array.isArray(value)) {
            const output: unknown[] = []
            const count = Math.min(value.length, MAX_ITEMS)
            let index = 0
            for (; index < count && remainingNodes > 0; index++) {
              output.push(convert(value[index], depth + 1, context))
            }
            if (value.length > index) output.push(TRUNCATED)
            return output
          }

          const input = value as Record<string, unknown>
          const output: Record<string, unknown> = {}
          let count = 0
          let truncated = false
          for (const key in input) {
            if (!propertyIsEnumerable.call(input, key)) break
            if (count >= MAX_ITEMS || remainingNodes <= 0) {
              truncated = true
              break
            }
            const converted = convert(input[key], depth + 1, new MediaTypeContext(input, key))
            Object.defineProperty(output, key, {
              value: converted,
              enumerable: true,
              writable: true,
              configurable: true,
            })
            count++
          }
          if (truncated) output[TRUNCATED] = 'Additional properties omitted'
          return output
        } finally {
          ancestors.delete(value)
        }
      } catch {
        // Includes hostile values and media-context getters. Never fall back to raw bytes.
        return UNSERIALIZABLE
      }
    }
    return convert(content, 0, MediaTypeContext.EMPTY)
  } catch {
    // A capture configuration getter can fail too; instrumentation remains best effort.
    return UNSERIALIZABLE
  }
}
