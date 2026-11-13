// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

export function truncate(str: string, max: number = 0): string {
  if (typeof str !== 'string' || max === 0) {
    return str
  }
  return str.length <= max ? str : `${str.slice(0, max)}...`
}

/**
 * Given any captured exception, extract its keys and create a sorted
 * and truncated list that will be used inside the event message.
 * eg. `Non-error exception captured with keys: foo, bar, baz`
 */
export function extractExceptionKeysForMessage(err: object, maxLength = 40): string {
  const keys = Object.keys(err)
  keys.sort()

  if (!keys.length) {
    return '[object has no keys]'
  }

  let serialized = ''
  for (const key of keys) {
    const next = serialized ? `${serialized}, ${key}` : key
    if (next.length > maxLength) {
      break
    }
    serialized = next
  }
  return serialized
}
