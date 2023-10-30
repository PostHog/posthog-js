/*
 * Saved references to long variable names, so that closure compiler can
 * minimize file size.
 */
export const ArrayProto = Array.prototype
export const nativeForEach = ArrayProto.forEach
export const nativeIndexOf = ArrayProto.indexOf
export const win: Window & typeof globalThis = typeof window !== 'undefined' ? window : ({} as typeof window)
const navigator = win.navigator || { userAgent: '' }
const document = win.document || {}
const userAgent = navigator.userAgent

export { win as window, userAgent, document }
