import { StyleSheet } from 'react-native'

/**
 * `StyleSheet.create` that returns the raw style map when the React Native
 * `StyleSheet` runtime is unavailable (e.g. Jest `testEnvironment: node` without
 * the RN preset), instead of throwing at import.
 * See https://github.com/PostHog/posthog-js/issues/3740.
 */
export const createSafeStyleSheet = <T extends StyleSheet.NamedStyles<T>>(styles: T): T => {
  try {
    return typeof StyleSheet?.create === 'function' ? StyleSheet.create(styles) : styles
  } catch {
    return styles
  }
}
