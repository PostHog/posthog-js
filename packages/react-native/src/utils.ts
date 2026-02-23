import { JsonType } from '@posthog/core'
import { Platform } from 'react-native'

type ReactNativeGlobal = {
  HermesInternal?: {
    enablePromiseRejectionTracker?: (args: {
      allRejections: boolean
      onUnhandled?: (id: string, error: any) => void
      onHandled?: (id: string, error: any) => void
    }) => void
    hasPromise?: () => boolean
  }
  ErrorUtils?: {
    getGlobalHandler?: () => (error: Error, isFatal: boolean) => void
    setGlobalHandler?: (handler: (error: Error, isFatal: boolean) => void) => void
  }
  onunhandledrejection?: (event: unknown) => void
}

// fallback for older environments
const _global: typeof global | undefined = typeof global !== 'undefined' ? global : undefined

// works after for ECMAScript 2020 (React Native >= 0.63)
const _globalThis: typeof globalThis | undefined = typeof globalThis !== 'undefined' ? globalThis : undefined

export const GLOBAL_OBJ = (_globalThis ?? _global) as unknown as ReactNativeGlobal

/** Checks if the current platform is web */
export function isWeb(): boolean {
  return Platform.OS === 'web'
}

/** Checks if the current platform is macOS */
export function isMacOS(): boolean {
  return Platform.OS === 'macos'
}

/** Checks if the current platform is Windows */
export function isWindows(): boolean {
  return Platform.OS === 'windows'
}

export const isHermes = () => !!GLOBAL_OBJ.HermesInternal

/**
 * Reads a boolean value from a remote config field.
 *
 * Remote config fields follow a pattern: they are either a boolean (false = disabled),
 * an object with specific keys, or absent/undefined.
 *
 * @param field The remote config field (e.g., `response.errorTracking`, `response.capturePerformance`)
 * @param key The key to read from the object form (e.g., `'autocaptureExceptions'`, `'network_timing'`)
 * @param defaultValue Value to return when the field is absent/undefined (defaults to `true` — don't block locally enabled capture)
 */
export function getRemoteConfigBool(
  field: boolean | { [key: string]: JsonType } | undefined,
  key: string,
  defaultValue: boolean = true
): boolean {
  if (field == null) {
    return defaultValue
  }
  if (typeof field === 'boolean') {
    return field
  }
  if (typeof field === 'object') {
    const value = field[key]
    return typeof value === 'boolean' ? value : defaultValue
  }
  return defaultValue
}

/**
 * Reads a numeric value from a remote config object field.
 *
 * Remote config values may be either numbers or numeric strings.
 *
 * @param field The remote config field (e.g. `response.sessionRecording`)
 * @param key The key to read (e.g. `'sampleRate'`)
 */
export function getRemoteConfigNumber(
  field: boolean | { [key: string]: JsonType } | undefined,
  key: string
): number | undefined {
  if (field == null || typeof field === 'boolean' || typeof field !== 'object') {
    return undefined
  }

  const value = field[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

/**
 * Checks whether a value is a valid session replay sample rate in the inclusive range [0, 1].
 */
export function isValidSampleRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}
