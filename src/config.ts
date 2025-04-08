/**
 * Set by @rollup/plugin-replace at build-time
 */
declare const BUILD_VERSION: string

// overridden in posthog-core,
// e.g.     Config.DEBUG = Config.DEBUG || instance.config.debug
const Config = {
    DEBUG: false,
    LIB_VERSION: BUILD_VERSION,
}

export default Config
