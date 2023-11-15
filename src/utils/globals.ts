/*
 * Saved references to long variable names, so that bundling can minimize file size.
 */
export const ArrayProto = Array.prototype
export const nativeForEach = ArrayProto.forEach
export const nativeIndexOf = ArrayProto.indexOf
// eslint-disable-next-line no-restricted-globals
export const win: Window & typeof globalThis = typeof window !== 'undefined' ? window : ({} as typeof window)
const navigator = win.navigator || { userAgent: '' }
export const document = win.document || {}
export const userAgent = navigator.userAgent

export { win as window }
