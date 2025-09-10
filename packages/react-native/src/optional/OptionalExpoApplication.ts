import type ExpoApplication from 'expo-application'
import { Platform } from 'react-native'

export let OptionalExpoApplication: typeof ExpoApplication | undefined = undefined

try {
  // macos not supported
  OptionalExpoApplication = Platform.select({
    macos: undefined,
    default: require('expo-application'),
  })
} catch (e) {}
