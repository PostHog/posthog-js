/** Traversal budgets and markers, shared with the OTLP attribute encoder. Not
 * public API — `utils/index.ts` re-exports `toJsonSafeValue` and `withoutNullMembers` only. */
export const MAX_JSON_SAFE_VALUE_DEPTH = 20
export const MAX_JSON_SAFE_VALUE_ITEMS = 1_000
export const MAX_JSON_SAFE_VALUE_NODES = 10_000
export const CIRCULAR_VALUE = '[Circular]'
export const TRUNCATED_VALUE = '[Truncated]'
export const UNSERIALIZABLE_VALUE = '[Unserializable]'
export const FUNCTION_VALUE = '[Function]'

const dateGetTime = Date.prototype.getTime
const dateToISOString = Date.prototype.toISOString
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable

interface JsonSafeValueConversionState {
  ancestors: WeakSet<object>
  remainingNodes: number
}

/**
 * Replaces unpaired surrogates with U+FFFD. A lone surrogate survives
 * `JSON.stringify` as a `\uD800`-style escape, which strict JSON parsers
 * reject — for OTLP that means the whole request is refused.
 */
export function sanitizeString(value: string): string {
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
 * Converts an arbitrary value, sanitizing `toJSON` results when available.
 * The limits keep pathological values from causing unbounded recursion or traversal.
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

        let hasToJSONResult = false
        let toJSONResult: unknown
        try {
          const toJSON = (current as { toJSON?: unknown }).toJSON
          if (typeof toJSON === 'function') {
            toJSONResult = toJSON.call(current)
            hasToJSONResult = true
          }
        } catch {
          hasToJSONResult = false
        }
        if (hasToJSONResult) {
          return convert(toJSONResult, depth + 1)
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

/**
 * Copies caller-supplied attributes onto `target`, own enumerable keys only.
 *
 * Read key by key rather than spread: a getter over a disposed resource or a
 * revoked proxy throws on the read itself, before the encoder's guards see it.
 */
export function assignUserAttributes<T extends Record<string, any>>(
  target: T,
  source: Record<string, unknown> | undefined
): T {
  if (!source) {
    return target
  }
  let keys: string[] = []
  try {
    keys = Object.keys(source)
  } catch {
    keys = []
  }
  for (const key of keys) {
    let value: unknown
    try {
      value = source[key]
    } catch {
      value = UNSERIALIZABLE_VALUE
    }
    // defineProperty, not assignment: `attributes['__proto__'] = v` hits the
    // prototype setter and the attribute vanishes.
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return target
}

/**
 * Removes object members whose value is `null` or `undefined`, recursively, without touching array positions: a null
 * array element stays `null`, and an object inside an array is replaced by its cleaned copy. Returns the input when
 * nothing changes, and copies only the containers that change. Only plain objects without a `toJSON` method are
 * cleaned; a value already being visited (a cycle), or nested `MAX_JSON_SAFE_VALUE_DEPTH` levels deep or more, is
 * returned as it is.
 *
 * @internal Exposed for cross-package use within this SDK; not part of the stable public API.
 */
export function withoutNullMembers<T>(value: T): T {
  const ancestors = new WeakSet<object>()
  const clean = <V>(current: V, depth: number): V => {
    if (
      current === null ||
      typeof current !== 'object' ||
      ancestors.has(current as object) ||
      depth >= MAX_JSON_SAFE_VALUE_DEPTH
    ) {
      return current
    }
    if (Array.isArray(current)) {
      ancestors.add(current)
      try {
        let changed = false
        const cleaned = current.map((item) => {
          const next = clean(item, depth + 1)
          changed = changed || next !== item
          return next
        })
        return (changed ? cleaned : current) as V
      } finally {
        ancestors.delete(current)
      }
    }
    const prototype = Object.getPrototypeOf(current)
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      typeof (current as { toJSON?: unknown }).toJSON === 'function'
    ) {
      return current
    }
    ancestors.add(current as object)
    try {
      let changed = false
      const cleaned: Record<string, unknown> = {}
      for (const [key, member] of Object.entries(current as Record<string, unknown>)) {
        if (member === null || member === undefined) {
          changed = true
          continue
        }
        const next = clean(member, depth + 1)
        changed = changed || next !== member
        // defineProperty, not assignment, so an own `__proto__` member is copied instead of setting the prototype.
        Object.defineProperty(cleaned, key, { value: next, enumerable: true, writable: true, configurable: true })
      }
      return (changed ? cleaned : current) as V
    } finally {
      ancestors.delete(current as object)
    }
  }
  return clean(value, 0)
}
