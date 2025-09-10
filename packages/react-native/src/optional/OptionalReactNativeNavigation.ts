import type ReactNativeNavigation from '@react-navigation/native'
import { Platform } from 'react-native'

export let OptionalReactNativeNavigation: typeof ReactNativeNavigation | undefined = undefined

try {
  // macos not supported
  OptionalReactNativeNavigation = Platform.select({
    macos: undefined,
    // experimental support for web https://reactnavigation.org/docs/web-support/
    default: require('@react-navigation/native'),
  })
} catch (e) {}
