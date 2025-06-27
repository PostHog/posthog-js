import type ExpoLocalization from 'expo-localization'
import { Platform } from 'react-native'

export let OptionalExpoLocalization: typeof ExpoLocalization | undefined = undefined

try {
  // macos not supported
  OptionalExpoLocalization = Platform.select({
    macos: undefined,
    default: require('expo-localization'),
  })
} catch (e) {}
