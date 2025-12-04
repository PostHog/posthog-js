import { Platform } from 'react-native'
import { OptionalAsyncStorage } from './optional/OptionalAsyncStorage'
import { OptionalExpoApplication } from './optional/OptionalExpoApplication'
import { OptionalExpoDevice } from './optional/OptionalExpoDevice'
import { OptionalExpoFileSystem } from './optional/OptionalExpoFileSystem'
import { OptionalExpoLocalization } from './optional/OptionalExpoLocalization'
import { OptionalReactNativeDeviceInfo } from './optional/OptionalReactNativeDeviceInfo'
import { PostHogCustomAppProperties, PostHogCustomStorage } from './types'
import { OptionalReactNativeLocalize } from './optional/OptionalReactNativeLocalize'
import { OptionalExpoFileSystemLegacy } from './optional/OptionalExpoFileSystemLegacy'

const getDeviceType = (): string => {
  let deviceType = 'Mobile'

  if (Platform.OS === 'macos' || Platform.OS === 'windows') {
    deviceType = 'Desktop'
  } else if (Platform.OS === 'web') {
    deviceType = 'Web'
  }
  return deviceType
}

export const currentDeviceType = getDeviceType()

export const getAppProperties = (): PostHogCustomAppProperties => {
  const properties: PostHogCustomAppProperties = {
    $device_type: currentDeviceType,
  }

  if (OptionalExpoApplication) {
    properties.$app_build = OptionalExpoApplication.nativeBuildVersion
    properties.$app_name = OptionalExpoApplication.applicationName
    properties.$app_namespace = OptionalExpoApplication.applicationId
    properties.$app_version = OptionalExpoApplication.nativeApplicationVersion
  } else if (OptionalReactNativeDeviceInfo) {
    properties.$app_build = returnPropertyIfNotUnknown(OptionalReactNativeDeviceInfo.getBuildNumber())
    properties.$app_name = returnPropertyIfNotUnknown(OptionalReactNativeDeviceInfo.getApplicationName())
    properties.$app_namespace = returnPropertyIfNotUnknown(OptionalReactNativeDeviceInfo.getBundleId())
    properties.$app_version = returnPropertyIfNotUnknown(OptionalReactNativeDeviceInfo.getVersion())
  }

  if (OptionalExpoDevice) {
    properties.$device_manufacturer = OptionalExpoDevice.manufacturer
    // expo-device already maps the device model identifier to a human readable name
    properties.$device_name = OptionalExpoDevice.modelName

    // https://github.com/expo/expo/issues/6990
    // some devices return a value similar to:
    // HUAWEI/SNE-LX1/HWSNE:8.1.0/HUAWEISNE-LX1/131(C432):user/release-keys
    if (Platform.OS === 'android') {
      properties.$os_name = 'Android'
    } else {
      properties.$os_name = OptionalExpoDevice.osName
    }

    properties.$os_version = OptionalExpoDevice.osVersion
  } else if (OptionalReactNativeDeviceInfo) {
    properties.$device_manufacturer = returnPropertyIfNotUnknown(OptionalReactNativeDeviceInfo.getManufacturerSync())
    // react-native-device-info already maps the device model identifier to a human readable name
    properties.$device_name = returnPropertyIfNotUnknown(OptionalReactNativeDeviceInfo.getModel())
    properties.$os_name = returnPropertyIfNotUnknown(OptionalReactNativeDeviceInfo.getSystemName())
    properties.$os_version = returnPropertyIfNotUnknown(OptionalReactNativeDeviceInfo.getSystemVersion())
  }

  if (OptionalExpoLocalization) {
    let locale: string | undefined | null
    if ('locale' in OptionalExpoLocalization) {
      locale = (OptionalExpoLocalization as any).locale
    } else if ('getLocales' in OptionalExpoLocalization) {
      locale = OptionalExpoLocalization.getLocales()[0].languageTag
    }
    if (locale) {
      properties.$locale = locale
    }

    let timezone: string | undefined | null
    if ('locale' in OptionalExpoLocalization) {
      timezone = (OptionalExpoLocalization as any).timezone
    } else if ('getCalendars' in OptionalExpoLocalization) {
      timezone = OptionalExpoLocalization.getCalendars()[0].timeZone
    }
    if (timezone) {
      properties.$timezone = timezone
    }
  } else if (OptionalReactNativeLocalize) {
    const localesFn = OptionalReactNativeLocalize.getLocales
    if (localesFn) {
      const locales = localesFn()

      if (locales && locales.length > 0) {
        const languageTag = locales[0].languageTag
        if (languageTag) {
          properties.$locale = languageTag
        }
      }
    }

    const timezoneFn = OptionalReactNativeLocalize.getTimeZone
    if (timezoneFn) {
      const timezone = timezoneFn()

      if (timezone) {
        properties.$timezone = timezone
      }
    }
  }

  return properties
}

// react-native-device-info returns 'unknown' if the property is not available (Web target)
const returnPropertyIfNotUnknown = (value: string | null): string | null => {
  if (value !== 'unknown') {
    return value
  }
  return null
}

const buildLegacyStorage = (filesystem: any): PostHogCustomStorage => {
  return {
    async getItem(key: string) {
      try {
        const uri = (filesystem.documentDirectory || '') + key
        const stringContent = await filesystem.readAsStringAsync(uri)
        return stringContent
      } catch (e) {
        return null
      }
    },

    async setItem(key: string, value: string) {
      const uri = (filesystem.documentDirectory || '') + key
      await filesystem.writeAsStringAsync(uri, value)
    },
  }
}

export const buildOptimisiticAsyncStorage = (): PostHogCustomStorage => {
  // expo-file-system is not supported on web and macos, so we need to use the react-native-async-storage package instead
  // see https://github.com/PostHog/posthog-js-lite/blob/5fb7bee96f739b243dfea5589e2027f16629e8cd/posthog-react-native/src/optional/OptionalExpoFileSystem.ts#L7-L11
  const supportedPlatform = Platform.OS !== 'web' && Platform.OS !== 'macos'

  // expo-54 uses expo-file-system v19 which removed the async methods and added new APIs
  // here we try to use the legacy package for back compatibility
  if (OptionalExpoFileSystemLegacy && supportedPlatform) {
    const filesystem = OptionalExpoFileSystemLegacy
    return buildLegacyStorage(filesystem)
  }

  // expo-54 and expo-file-system v19 new APIs support
  if (OptionalExpoFileSystem && supportedPlatform) {
    const filesystem = OptionalExpoFileSystem

    try {
      const expoFileSystemLegacy = filesystem as any
      // identify legacy APIs with older versions (expo <= 53 and expo-file-system <= 18)
      if (expoFileSystemLegacy.readAsStringAsync) {
        return buildLegacyStorage(filesystem)
      }
    } catch (e) {}

    // expo >= 54 and expo-file-system >= 19
    return {
      async getItem(key: string) {
        try {
          const uri = ((filesystem as any).Paths?.document.info().uri || '') + key
          const file = new (filesystem as any).File(uri)
          const stringContent = await file.text()
          return stringContent
        } catch (e) {
          return null
        }
      },

      async setItem(key: string, value: string) {
        const uri = ((filesystem as any).Paths?.document.info().uri || '') + key
        const file = new (filesystem as any).File(uri)
        file.write(value)
      },
    }
  }

  if (OptionalAsyncStorage) {
    return OptionalAsyncStorage
  }

  throw new Error(
    'PostHog: No storage available. Please install expo-file-system or react-native-async-storage OR implement a custom storage provider.'
  )
}
