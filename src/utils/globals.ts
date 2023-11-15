/*
 * Saved references to long variable names, so that bundling can minimize file size.
 */
export const ArrayProto = Array.prototype
export const nativeForEach = ArrayProto.forEach
export const nativeIndexOf = ArrayProto.indexOf
// eslint-disable-next-line no-restricted-globals
export const win: (Window & typeof globalThis) | undefined = typeof window !== 'undefined' ? window : undefined
const navigator = win?.navigator
export const document = win?.document
export const userAgent = navigator?.userAgent

export { win as window }
