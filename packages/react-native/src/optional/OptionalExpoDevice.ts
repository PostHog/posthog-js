import type ExpoDevice from 'expo-device'
import { Platform } from 'react-native'

export let OptionalExpoDevice: typeof ExpoDevice | undefined = undefined

try {
  // macos not supported
  OptionalExpoDevice = Platform.select({
    macos: undefined,
    default: require('expo-device'),
  })
} catch (e) {}
