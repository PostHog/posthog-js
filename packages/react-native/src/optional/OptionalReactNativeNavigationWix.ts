import { Platform } from 'react-native'
import type ReactNativeNavigationWix from 'react-native-navigation'

export let OptionalReactNativeNavigationWix: typeof ReactNativeNavigationWix | undefined = undefined

try {
  // macos/web not supported
  OptionalReactNativeNavigationWix = Platform.select({
    macos: undefined,
    web: undefined,
    default: require('react-native-navigation'),
  })
} catch (e) {}
