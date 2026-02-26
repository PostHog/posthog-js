import { Platform } from 'react-native'
import { OptionalAsyncStorage } from './optional/OptionalAsyncStorage'
import { GLOBAL_OBJ, isMacOS, isWeb, isWindows } from './utils'
import { OptionalExpoApplication } from './optional/OptionalExpoApplication'
import { OptionalExpoDevice } from './optional/OptionalExpoDevice'
import { OptionalExpoFileSystem } from './optional/OptionalExpoFileSystem'
import { OptionalExpoLocalization } from './optional/OptionalExpoLocalization'
import { OptionalReactNativeDeviceInfo } from './optional/OptionalReactNativeDeviceInfo'
import { PostHogCustomAppProperties, PostHogCustomStorage } from './types'
import { OptionalReactNativeLocalize } from './optional/OptionalReactNativeLocalize'
import { OptionalExpoFileSystemLegacy } from './optional/OptionalExpoFileSystemLegacy'
import { detectDeviceType } from '@posthog/core'

const getDeviceType = (): string => {
  let deviceType = 'Mobile'

  if (isMacOS() || isWindows()) {
    deviceType = 'Desktop'
  } else if (isWeb()) {
    // Check user agent to determine if it's desktop or mobile
    const ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : ''

    deviceType = detectDeviceType(ua)
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
    // expo-localization >= 14 use functions to get these results, older versions use JS getters
    // https://github.com/expo/expo/blob/sdk-54/packages/expo-localization/CHANGELOG.md#1400--2022-10-25
    // this type below supports both variants, and type-checks with older and newer versions of expo-localization
    const optionalExpoLocalization: {
      locale?: string
      getLocales?: () => {
        languageTag: string
      }[]
      timezone?: string
      getCalendars?: () => {
        timeZone: string | null
      }[]
    } = OptionalExpoLocalization

    let locale = optionalExpoLocalization.locale
    if (!locale && optionalExpoLocalization.getLocales) {
      locale = optionalExpoLocalization.getLocales()[0]?.languageTag
    }
    if (locale) {
      properties.$locale = locale
    }
    let timezone: string | undefined | null = optionalExpoLocalization.timezone
    if (!timezone && optionalExpoLocalization.getCalendars) {
      timezone = optionalExpoLocalization.getCalendars()[0]?.timeZone
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

export const buildOptimisiticAsyncStorage = (): PostHogCustomStorage | undefined => {
  // On web platform during SSR (no window), skip file storage
  // The caller will fall back to memory storage
  if (isWeb() && typeof (GLOBAL_OBJ as any)?.window === 'undefined') {
    return undefined
  }

  // expo-file-system is not supported on web and macos, so we need to use the react-native-async-storage package instead
  // see https://github.com/PostHog/posthog-js-lite/blob/5fb7bee96f739b243dfea5589e2027f16629e8cd/posthog-react-native/src/optional/OptionalExpoFileSystem.ts#L7-L11
  const supportedPlatform = !isWeb() && !isMacOS()

  // expo-file-system is only supported on native platforms (not web/macOS).
  // See https://github.com/PostHog/posthog-js-lite/issues/140
  if (supportedPlatform) {
    // expo >= 54 and expo-file-system >= 19: prefer the new File/Paths API.
    // We always check for the new API first because:
    // - SDK 54 stable exports legacy methods (readAsStringAsync, writeAsStringAsync) that throw
    //   a deprecation error when called, so existence checks alone are unreliable.
    // - SDK 55+ has a working legacy subpath, but the new API is the recommended approach.
    // See https://github.com/PostHog/posthog-js/issues/3151
    if (OptionalExpoFileSystem) {
      const filesystem = OptionalExpoFileSystem as any

      if (filesystem.Paths && filesystem.File) {
        return {
          async getItem(key: string) {
            try {
              // File constructor accepts Directory instances and joins path segments
              // See https://docs.expo.dev/versions/latest/sdk/filesystem/
              const file = new filesystem.File(filesystem.Paths.document, key)
              const stringContent = await file.text()
              return stringContent
            } catch (e) {
              return null
            }
          },

          async setItem(key: string, value: string) {
            const file = new filesystem.File(filesystem.Paths.document, key)
            await file.write(value)
          },
        }
      }
    }

    // Fallback to legacy APIs for older Expo versions (expo <= 53, expo-file-system <= 18).
    // Try the legacy subpath first (available in SDK 55+), then the main module.
    // We validate that readAsStringAsync is a real function before using it,
    // to avoid calling deprecated stubs that throw at runtime (SDK 54 stable).
    const legacyModule = (OptionalExpoFileSystemLegacy || OptionalExpoFileSystem) as any
    try {
      if (legacyModule && typeof legacyModule.readAsStringAsync === 'function') {
        return buildLegacyStorage(legacyModule)
      }
    } catch (e) {}
  }

  if (OptionalAsyncStorage) {
    return OptionalAsyncStorage
  }

  throw new Error(
    'PostHog: No storage available. Please install expo-file-system or react-native-async-storage OR implement a custom storage provider.'
  )
}
