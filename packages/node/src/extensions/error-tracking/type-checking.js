// Portions of this file are derived from getsentry/sentry-javascript by Software, Inc. dba Sentry
// Licensed under the MIT License
export function isEvent(candidate) {
    return typeof Event !== 'undefined' && isInstanceOf(candidate, Event);
}
export function isPlainObject(candidate) {
    return isBuiltin(candidate, 'Object');
}
export function isError(candidate) {
    switch (Object.prototype.toString.call(candidate)) {
        case '[object Error]':
        case '[object Exception]':
        case '[object DOMException]':
        case '[object WebAssembly.Exception]':
            return true;
        default:
            return isInstanceOf(candidate, Error);
    }
}
export function isInstanceOf(candidate, base) {
    try {
        return candidate instanceof base;
    }
    catch {
        return false;
    }
}
export function isErrorEvent(event) {
    return isBuiltin(event, 'ErrorEvent');
}
export function isBuiltin(candidate, className) {
    return Object.prototype.toString.call(candidate) === `[object ${className}]`;
}
//# sourceMappingURL=type-checking.js.map