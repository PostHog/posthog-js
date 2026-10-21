/** JSON accepted in evaluation payloads. No implicit toJSON or string conversion. */
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue }
export type JSONObject = { [key: string]: JSONValue }
/** Large signed-64-bit counts use bigint; safe counts are returned as numbers. */
export type EvaluationCount = number | bigint
export type WireObject = Record<string, unknown>

export function object(value: unknown): WireObject {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object.')
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) throw new TypeError('Expected a plain object.')
    return value as WireObject
}

export function text(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('Expected a string.')
    // Reject NUL and lone UTF-16 surrogates instead of silently repairing content.
    for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i)
        if (c === 0) throw new TypeError('Strings cannot contain null characters.')
        if (c >= 0xd800 && c <= 0xdbff) {
            const next = value.charCodeAt(++i)
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Strings must contain valid Unicode.')
        } else if (c >= 0xdc00 && c <= 0xdfff) throw new TypeError('Strings must contain valid Unicode.')
    }
    return value
}
export function identifier(value: unknown, max = 255): string {
    const result = text(value)
    if (!result || [...result].length > max)
        throw new TypeError(`Expected a nonempty identifier of at most ${max} characters.`)
    return result
}
export function integer(value: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new TypeError(`Expected a safe integer between ${minimum} and ${maximum}.`)
    }
    return value
}
export function count(value: unknown): EvaluationCount {
    if (typeof value === 'bigint') {
        if (value < 0n || value > 9223372036854775807n)
            throw new TypeError('Count must fit a nonnegative signed 64-bit integer.')
        return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
    }
    return integer(value, 0)
}
export function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new TypeError('Expected a boolean.')
    return value
}
export function uuid(value: unknown): string {
    const raw = text(value)
        .replace(/^urn:uuid:/i, '')
        .replace(/^\{(.*)\}$/, '$1')
        .replace(/-/g, '')
    if (!/^[0-9a-f]{32}$/i.test(raw)) throw new TypeError('Expected a UUID.')
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`.toLowerCase()
}
export function timestamp(value: unknown): string {
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) throw new TypeError('Expected a valid timestamp.')
        return value.toISOString()
    }
    const raw = text(value)
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(raw)
    if (!match) throw new TypeError('Timestamps must include a timezone.')
    const date = new Date(`${match[1]}T${match[2]}${match[4]}`)
    // Check the calendar component separately: Date.parse accepts February 30.
    const day = new Date(`${match[1]}T00:00:00Z`)
    if (
        !Number.isFinite(date.getTime()) ||
        !Number.isFinite(day.getTime()) ||
        day.toISOString().slice(0, 10) !== match[1] ||
        match[2].startsWith('24:')
    ) {
        throw new TypeError('Expected a valid timestamp.')
    }
    return date.toISOString().replace('.000Z', `${match[3] ?? '.000'}Z`)
}

export function json(value: unknown, depth = 1, ancestors = new Set<unknown>()): JSONValue {
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') return text(value)
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.')
        return value
    }
    if (typeof value !== 'object') throw new TypeError('Expected JSON values without automatic conversion.')
    if (depth > 32 || ancestors.has(value)) throw new TypeError('JSON must be acyclic and at most 32 containers deep.')
    ancestors.add(value)
    try {
        if (Array.isArray(value)) {
            if (
                Reflect.ownKeys(value).some(
                    (key) =>
                        key !== 'length' &&
                        (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
                )
            )
                throw new TypeError('Unexpected array property.')
            const result: JSONValue[] = []
            for (let i = 0; i < value.length; i++) {
                const d = Object.getOwnPropertyDescriptor(value, String(i))
                if (!d || !('value' in d)) throw new TypeError('Sparse arrays and accessors are not JSON.')
                result.push(json(d.value, depth + 1, ancestors))
            }
            return result
        }
        const source = object(value)
        return Object.fromEntries(
            Reflect.ownKeys(source).map((key) => {
                if (typeof key !== 'string') throw new TypeError('JSON keys must be strings.')
                text(key)
                const d = Object.getOwnPropertyDescriptor(source, key)!
                if (!('value' in d) || !d.enumerable)
                    throw new TypeError('JSON objects must contain enumerable data properties.')
                return [key, json(d.value, depth + 1, ancestors)]
            })
        )
    } finally {
        ancestors.delete(value)
    }
}
export function metadata(value: unknown): JSONObject {
    return json(object(value)) as JSONObject
}

/** Convert losslessly decoded response integers only when JavaScript can retain their value. */
export function responseJSON(value: unknown): JSONValue {
    function convert(current: unknown): unknown {
        if (typeof current === 'bigint') {
            const number = Number(current)
            if (!Number.isFinite(number) || BigInt(number) !== current)
                throw new TypeError('Response JSON integer cannot be represented exactly.')
            return number
        }
        if (Array.isArray(current)) return current.map(convert)
        if (current !== null && typeof current === 'object')
            return Object.fromEntries(Object.entries(object(current)).map(([key, v]) => [key, convert(v)]))
        return current
    }
    return json(convert(value))
}
export function responseMetadata(value: unknown): JSONObject {
    object(value)
    return responseJSON(value) as JSONObject
}

/** Internal codec: bigint is allowed only after validation of designated count fields. */
export function encode(value: unknown): string {
    if (typeof value === 'bigint') return value.toString()
    if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`
    if (value !== null && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${encode((value as WireObject)[key])}`)
            .join(',')}}`
    }
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError('Cannot encode undefined.')
    return encoded
}

/** Preserve integer tokens before JSON.parse can round signed-64-bit counters. */
export function decode(source: string): unknown {
    JSON.parse(source) // Use the native parser to validate the complete grammar first.
    const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]/g)!
    let i = 0
    function read(depth: number): unknown {
        if (depth > 256) throw new TypeError('Response JSON nesting is too deep.')
        const token = tokens[i++]
        if (token === '{') {
            const entries: [string, unknown][] = []
            while (tokens[i] !== '}') {
                const key = JSON.parse(tokens[i++]) as string
                i++
                entries.push([key, read(depth + 1)])
                if (tokens[i] !== ',') break
                i++
            }
            i++
            return Object.fromEntries(entries)
        }
        if (token === '[') {
            const values: unknown[] = []
            while (tokens[i] !== ']') {
                values.push(read(depth + 1))
                if (tokens[i] !== ',') break
                i++
            }
            i++
            return values
        }
        if (/^-?\d+$/.test(token)) {
            const exact = BigInt(token)
            if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < BigInt(Number.MIN_SAFE_INTEGER)) return exact
        }
        return JSON.parse(token) as unknown
    }
    return read(0)
}
export function copy<T>(value: T): T {
    return structuredClone(value)
}
export function bytes(value: string): number {
    return new TextEncoder().encode(value).length
}
export function keys(value: object, allowed: readonly string[]): void {
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError('Unsupported option.')
        const d = Object.getOwnPropertyDescriptor(value, key)!
        if (!('value' in d)) throw new TypeError('Options cannot contain accessors.')
    }
}
export function defined(value: WireObject): WireObject {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}
export function nullable<T>(value: unknown, parse: (v: unknown) => T): T | null {
    return value === null ? null : parse(value)
}
export function tags(value: unknown, limit = 100): string[] {
    if (!Array.isArray(value) || value.length > limit) throw new TypeError(`Expected at most ${limit} tag names.`)
    return value.map((v) => {
        const s = text(v)
        identifier(s.trim())
        return s
    })
}
export function responseTags(value: unknown): string[] {
    if (!Array.isArray(value)) throw new TypeError('Expected tags.')
    return value.map(text)
}
export function tagParams(value: readonly string[] | undefined, match: 'any' | 'all' = 'any'): WireObject {
    if (match !== 'any' && match !== 'all') throw new TypeError('Unsupported tag matching mode.')
    return defined({
        tags: value === undefined ? undefined : encode(tags(value, 20)),
        tag_match: value !== undefined || match !== 'any' ? match : undefined,
    })
}
export function pageParams(limit: number, offset: number, maximum = 100): WireObject {
    return { limit: integer(limit, 1, maximum), offset: integer(offset, 0) }
}
export function nextOffset(value: unknown, offset: number): number | null {
    if (value === null) return null
    const params = new URL(text(value), 'https://pagination.invalid').searchParams.getAll('offset')
    if (params.length !== 1 || !/^\d+$/.test(params[0])) throw new TypeError('Invalid page continuation.')
    return integer(Number(params[0]), offset + 1)
}
export interface Page<T> {
    count: EvaluationCount
    results: T[]
    nextOffset: number | null
}
export function page<T>(data: WireObject, parse: (value: WireObject) => T, offset: number): Page<T> {
    if (!Array.isArray(data.results)) throw new TypeError('Expected page results.')
    const results = data.results.map((v) => parse(object(v)))
    const next = nextOffset(data.next, offset)
    if (next !== null && results.length === 0) throw new TypeError('Empty page has a continuation.')
    return { count: count(data.count), results, nextOffset: next }
}
