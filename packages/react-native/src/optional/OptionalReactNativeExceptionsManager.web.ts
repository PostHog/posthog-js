import type { ReactNativeExceptionsManager } from './OptionalReactNativeExceptionsManager'

// Web bundles resolve this file instead, so React Native's ExceptionsManager and its native-only
// imports stay out of the web dependency graph.
export const OptionalReactNativeExceptionsManager: ReactNativeExceptionsManager | undefined = undefined
