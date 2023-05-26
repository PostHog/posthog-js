export function isEvent(candidate: unknown): candidate is Event {
    return typeof Event !== 'undefined' && isInstanceOf(candidate, Event)
}

export function isPlainObject(candidate: unknown): candidate is Record<string, unknown> {
    return isBuiltin(candidate, 'Object')
}

export function isInstanceOf(candidate: unknown, base: any): boolean {
    try {
        return candidate instanceof base
    } catch (_e) {
        return false
    }
}

export function isPrimitive(
    candidate: unknown
): candidate is number | string | boolean | bigint | symbol | null | undefined {
    return candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')
}

export function isError(candidate: unknown): candidate is Error {
    switch (Object.prototype.toString.call(candidate)) {
        case '[object Error]':
        case '[object Exception]':
        case '[object DOMException]':
            return true
        default:
            return isInstanceOf(candidate, Error)
    }
}

export function isErrorEvent(event: string | Error | Event): event is ErrorEvent {
    return isBuiltin(event, 'ErrorEvent')
}

export function isErrorWithStack(candidate: unknown): candidate is Error {
    return 'stack' in (candidate as Error)
}

export function isBuiltin(candidate: unknown, className: string): boolean {
    return Object.prototype.toString.call(candidate) === `[object ${className}]`
}

export function isDOMException(candidate: unknown): boolean {
    return isBuiltin(candidate, 'DOMException')
}

export function isDOMError(candidate: unknown): boolean {
    return isBuiltin(candidate, 'DOMError')
}
