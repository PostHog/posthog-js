import { Platform } from 'react-native'

// Only read the public constants we use; older or unlinked modules may omit them.
type ExpoUpdatesContext = {
  isEnabled?: boolean
  updateId?: string | null
  runtimeVersion?: string | null
  channel?: string | null
  isEmbeddedLaunch?: boolean
}

export let OptionalExpoUpdates: ExpoUpdatesContext | undefined

if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    // Metro recognizes optional dependencies only when require is directly inside the try block.
    OptionalExpoUpdates = require('expo-updates')
  } catch {}
}
