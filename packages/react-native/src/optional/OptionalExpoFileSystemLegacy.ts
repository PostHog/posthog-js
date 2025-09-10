// expo <= 54 and expo-file-system <=19 back compatibility support

// @ts-ignore  -- legacy subpath has no .d.ts; type-only import is fine
import type FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

export let OptionalExpoFileSystemLegacy: typeof FileSystem | undefined = undefined

try {
  // do not try to load expo-file-system on web and macos, otherwise it will throw an error
  // See https://github.com/PostHog/posthog-js-lite/issues/140
  // Once expo-file-system is supported on web/macos, we can remove this try/catch block
  // For now, use the react-native-async-storage/async-storage package instead
  OptionalExpoFileSystemLegacy = Platform.select({
    macos: undefined,
    web: undefined,
    default: require('expo-file-system/legacy'),
  })
} catch (e) {}
