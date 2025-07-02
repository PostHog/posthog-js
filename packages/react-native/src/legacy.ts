import { Platform } from 'react-native'
import { OptionalExpoApplication } from './optional/OptionalExpoApplication'
import { OptionalExpoFileSystem } from './optional/OptionalExpoFileSystem'

export const getLegacyValues = async (): Promise<{ distinctId?: string; anonymousId?: string } | undefined> => {
  // NOTE: The old react-native lib stored data in files on the filesystem.
  // This function takes care of pulling the legacy IDs to ensure we are using them if already present

  if (!OptionalExpoFileSystem || !OptionalExpoApplication) {
    return
  }

  // legacy didn't support macos, no need to check it
  if (Platform.OS === 'ios') {
    const posthogFileDirectory = `${OptionalExpoFileSystem.documentDirectory}../Library/Application%20Support/${OptionalExpoApplication.applicationId}/`
    const posthogDistinctIdFile = posthogFileDirectory + 'posthog.distinctId'
    const posthogAnonymousIdFile = posthogFileDirectory + 'posthog.anonymousId'

    const res = {
      distinctId: undefined,
      anonymousId: undefined,
    }

    try {
      res.distinctId = JSON.parse(await OptionalExpoFileSystem.readAsStringAsync(posthogDistinctIdFile))[
        'posthog.distinctId'
      ]
    } catch (e) {}

    try {
      res.anonymousId = JSON.parse(await OptionalExpoFileSystem.readAsStringAsync(posthogAnonymousIdFile))[
        'posthog.anonymousId'
      ]
    } catch (e) {}

    return res
  } else {
    // NOTE: Android is not supported here as the old SDK used a very Expo-unfriendly way of storing data
  }
}
