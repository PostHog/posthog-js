import Config from '@posthog/browser-common/config'
import packageInfo from '../package.json'

// overridden in posthog-core,
// e.g.     Config.DEBUG = Config.DEBUG || instance.config.debug
Config.DEBUG = false
Config.LIB_VERSION = packageInfo.version
Config.LIB_NAME = 'web'
/** The actual JS SDK version, unaffected by _overrideSDKInfo. Used for the `ver` request param. */
Config.JS_SDK_VERSION = packageInfo.version

export default Config
