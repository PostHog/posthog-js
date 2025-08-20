import { knownUnsafeEditableEvent, KnownUnsafeEditableEvent } from '../types'
import { includes } from './string-utils'

const ObjProto = Object.prototype
const toString = ObjProto.toString

// from a comment on http://dbj.org/dbj/?p=286
// fails on only one very rare and deliberate custom object:
// let bomb = { toString : undefined, valueOf: function(o) { return "function BOMBA!"; }};
export const isFunction = (x: unknown): x is (...args: any[]) => any => {
  // eslint-disable-next-line posthog-js/no-direct-function-check
  return typeof x === 'function'
}

export const isNativeFunction = (x: unknown): x is (...args: any[]) => any =>
  isFunction(x) && x.toString().indexOf('[native code]') !== -1

// Underscore Addons
export const isUndefined = (x: unknown): x is undefined => x === void 0

export const isString = (x: unknown): x is string => {
  // eslint-disable-next-line posthog-js/no-direct-string-check
  return toString.call(x) == '[object String]'
}

export const isEmptyString = (x: unknown): boolean => isString(x) && x.trim().length === 0

export const isNull = (x: unknown): x is null => {
  // eslint-disable-next-line posthog-js/no-direct-null-check
  return x === null
}

/*
    sometimes you want to check if something is null or undefined
    that's what this is for
 */
export const isNullish = (x: unknown): x is null | undefined => isUndefined(x) || isNull(x)

export const isNumber = (x: unknown): x is number => {
  // eslint-disable-next-line posthog-js/no-direct-number-check
  return toString.call(x) == '[object Number]'
}
export const isBoolean = (x: unknown): x is boolean => {
  // eslint-disable-next-line posthog-js/no-direct-boolean-check
  return toString.call(x) === '[object Boolean]'
}

export const isFormData = (x: unknown): x is FormData => {
  // eslint-disable-next-line posthog-js/no-direct-form-data-check
  return x instanceof FormData
}

export const isFile = (x: unknown): x is File => {
  // eslint-disable-next-line posthog-js/no-direct-file-check
  return x instanceof File
}

export const isError = (x: unknown): x is Error => {
  return x instanceof Error
}

export const isKnownUnsafeEditableEvent = (x: unknown): x is KnownUnsafeEditableEvent => {
  return includes(knownUnsafeEditableEvent as unknown as string[], x)
}
