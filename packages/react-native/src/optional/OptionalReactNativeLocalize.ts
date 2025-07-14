interface ReactNativeLocalize {
  getLocales: () => {
    languageCode: string
    scriptCode?: string
    countryCode: string
    languageTag: string
    isRTL: boolean
  }[]

  getTimeZone(): string
}

import type ReactNativeLocalize from 'react-native-localize'

export let OptionalReactNativeLocalize: typeof ReactNativeLocalize | undefined = undefined

// web support requires webpack
// https://github.com/zoontek/react-native-localize#web-support
try {
  OptionalReactNativeLocalize = require('react-native-localize')
} catch (e) {}
