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
  field: boolean | { [key: string]: unknown } | undefined,
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
