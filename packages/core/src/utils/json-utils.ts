const MAX_JSON_SAFE_VALUE_DEPTH = 20
const MAX_JSON_SAFE_VALUE_ITEMS = 1_000
const MAX_JSON_SAFE_VALUE_NODES = 10_000
const CIRCULAR_VALUE = '[Circular]'
const TRUNCATED_VALUE = '[Truncated]'
const UNSERIALIZABLE_VALUE = '[Unserializable]'
const FUNCTION_VALUE = '[Function]'

const dateGetTime = Date.prototype.getTime
const dateToISOString = Date.prototype.toISOString
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

interface JsonSafeValueConversionState {
  ancestors: WeakSet<object>
  remainingNodes: number
}

function sanitizeString(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        output += value[index] + value[index + 1]
        index++
      } else {
        output += '\ufffd'
      }
    } else {
      output += codeUnit >= 0xdc00 && codeUnit <= 0xdfff ? '\ufffd' : value[index]
    }
  }
  return output
}

/**
 * Converts an arbitrary value without invoking `toJSON`. The limits keep
 * pathological values from causing unbounded recursion or traversal.
 */
export function toJsonSafeValue(value: unknown): unknown {
  const state: JsonSafeValueConversionState = {
    ancestors: new WeakSet(),
    remainingNodes: MAX_JSON_SAFE_VALUE_NODES,
  }

  const convert = (current: unknown, depth: number): unknown => {
    if (state.remainingNodes <= 0) {
      return TRUNCATED_VALUE
    }
    state.remainingNodes--

    try {
      if (current === null || current === undefined || typeof current === 'boolean') {
        return current
      }
      if (typeof current === 'string') {
        return sanitizeString(current)
      }
      if (typeof current === 'number') {
        return Number.isFinite(current) ? current : null
      }
      if (typeof current === 'bigint') {
        return current.toString()
      }
      if (typeof current === 'function') {
        return FUNCTION_VALUE
      }
      if (typeof current === 'symbol') {
        return current.description ? `Symbol(${current.description})` : 'Symbol()'
      }
      if (depth >= MAX_JSON_SAFE_VALUE_DEPTH) {
        return TRUNCATED_VALUE
      }

      if (state.ancestors.has(current)) {
        return CIRCULAR_VALUE
      }

      state.ancestors.add(current)
      try {
        if (current instanceof Date) {
          return Number.isFinite(dateGetTime.call(current)) ? dateToISOString.call(current) : null
        }

        if (Array.isArray(current)) {
          const itemCount = Math.min(current.length, MAX_JSON_SAFE_VALUE_ITEMS)
          const output: unknown[] = []
          let index = 0
          for (; index < itemCount && state.remainingNodes > 0; index++) {
            output.push(convert(current[index], depth + 1))
          }
          if (current.length > index) {
            output.push(TRUNCATED_VALUE)
          }
          return output
        }

        const output: Record<string, unknown> = {}
        let itemCount = 0
        let truncated = false
        for (const key in current) {
          // for...in visits own enumerable keys before walking the prototype chain.
          if (!propertyIsEnumerable.call(current, key)) {
            break
          }
          if (itemCount >= MAX_JSON_SAFE_VALUE_ITEMS || state.remainingNodes <= 0) {
            truncated = true
            break
          }
          const converted = convert((current as Record<string, unknown>)[key], depth + 1)
          Object.defineProperty(output, key, {
            value: converted,
            enumerable: true,
            configurable: true,
            writable: true,
          })
          itemCount++
        }
        if (truncated) {
          output[TRUNCATED_VALUE] = 'Additional properties omitted'
        }
        return output
      } finally {
        state.ancestors.delete(current)
      }
    } catch {
      return UNSERIALIZABLE_VALUE
    }
  }

  return convert(value, 0)
}
