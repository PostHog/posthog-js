import { Platform } from 'react-native'
import type ReactNativeDeviceInfo from 'react-native-device-info'

export let OptionalReactNativeDeviceInfo: typeof ReactNativeDeviceInfo | undefined = undefined

try {
  // macos not supported
  OptionalReactNativeDeviceInfo = Platform.select({
    macos: undefined,
    default: require('react-native-device-info'), // No Web support, returns unknown
  })
} catch (e) {}
