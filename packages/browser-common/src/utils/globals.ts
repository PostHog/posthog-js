/*
 * Global helpers to protect access to browser globals in a way that is safer for different targets
 * like DOM, SSR, Web workers etc.
 *
 * Typically we want the browser `window`, but `globalThis` works for browser, workers, and SSR-ish targets.
 * Export optional globals so callers are forced to handle absence.
 */

const win: (Window & typeof globalThis) | undefined = typeof window !== 'undefined' ? window : undefined
const global: typeof globalThis | undefined = typeof globalThis !== 'undefined' ? globalThis : win

export const navigator = global?.navigator
export const document = global?.document
export const location = global?.location
export const fetch = global?.fetch
export const XMLHttpRequest =
    global?.XMLHttpRequest && 'withCredentials' in new global.XMLHttpRequest() ? global.XMLHttpRequest : undefined
export const AbortController = global?.AbortController
export const CompressionStream = global?.CompressionStream
export const userAgent = navigator?.userAgent

export type TimeoutID = ReturnType<typeof globalThis.setTimeout>

/*
 * Timers are read from the global object on every call, never captured at load. A realm can lose
 * them after load (a torn-down or sandboxed frame), where the bare `setTimeout` identifier throws
 * a `ReferenceError` instead of being undefined. Callers get `undefined` back and must handle a
 * realm with no timers.
 */
export function setTimeout(callback: () => void, timeout?: number): TimeoutID | undefined {
    return global?.setTimeout ? global.setTimeout(callback, timeout) : undefined
}

export function clearTimeout(id: TimeoutID | undefined): void {
    global?.clearTimeout?.(id)
}

export function isBrowserOnline(): boolean {
    return !!(win && win.navigator.onLine !== false)
}

export { win as window }
