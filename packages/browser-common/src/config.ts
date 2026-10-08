declare const __BROWSER_COMMON_VERSION__: string

type SDKDistChannel = 'npm' | 'cdn'

const packageVersion = typeof __BROWSER_COMMON_VERSION__ === 'string' ? __BROWSER_COMMON_VERSION__ : '0.0.0'

const Config: {
    DEBUG: boolean
    LIB_VERSION: string
    LIB_NAME: string
    SDK_DIST_CHANNEL?: SDKDistChannel
    JS_SDK_VERSION: string
} = {
    DEBUG: false,
    LIB_VERSION: packageVersion,
    LIB_NAME: 'browser-common',
    JS_SDK_VERSION: packageVersion,
}

export default Config
