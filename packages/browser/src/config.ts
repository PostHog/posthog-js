import { setLoggerDebugEnabled } from '@posthog/browser-common/utils/logger'

import packageInfo from '../package.json'

type SDKDistChannel = 'npm' | 'cdn'

let debugEnabled = false

// overridden in posthog-core,
// e.g.     Config.DEBUG = Config.DEBUG || instance.config.debug
const Config: {
    DEBUG: boolean
    LIB_VERSION: string
    LIB_NAME: string
    SDK_DIST_CHANNEL?: SDKDistChannel
    JS_SDK_VERSION: string
} = {
    get DEBUG() {
        return debugEnabled
    },
    set DEBUG(value: boolean) {
        debugEnabled = !!value
        setLoggerDebugEnabled(debugEnabled)
    },
    LIB_VERSION: packageInfo.version,
    LIB_NAME: 'web',
    /** The actual JS SDK version, unaffected by _overrideSDKInfo. Used for the `ver` request param. */
    JS_SDK_VERSION: packageInfo.version,
}

export default Config
