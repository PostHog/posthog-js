// Console wrappers share rrweb's marker so separately loaded bundles can resolve the same original method.
export type ConsoleMethod = ((...args: any[]) => void) & {
    __rrweb_original__?: ConsoleMethod
}

export const getOriginalConsoleMethod = (method: ConsoleMethod): ConsoleMethod => {
    while (method?.__rrweb_original__) {
        method = method.__rrweb_original__
    }
    return method
}

export const markConsoleWrapper = (wrapper: ConsoleMethod, original: ConsoleMethod): ConsoleMethod => {
    wrapper.__rrweb_original__ = getOriginalConsoleMethod(original)
    return wrapper
}
