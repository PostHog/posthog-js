import { Platform } from 'react-native'

// React Native's internal exception reporter. React 19's root `onUncaughtError` and
// `onCaughtError` callbacks report through `handleException` without going through ErrorUtils.
// Callers read `handleException` off this object at call time, so it can be wrapped in place.
export type ReactNativeExceptionsManager = {
  handleException?: (error: unknown, isFatal: boolean) => void
}

export let OptionalReactNativeExceptionsManager: ReactNativeExceptionsManager | undefined

if (Platform.OS !== 'web') {
  try {
    // Metro recognizes optional dependencies only when require is directly inside the try block.
    const exceptionsManager = require('react-native/Libraries/Core/ExceptionsManager')
    // CommonJS `module.exports` up to RN 0.78, an ES default export from 0.79.
    OptionalReactNativeExceptionsManager = exceptionsManager?.default ?? exceptionsManager
  } catch {}
}
