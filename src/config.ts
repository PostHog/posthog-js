import { version } from '../package.json'

// overridden in posthog-core,
// e.g.     Config.DEBUG = Config.DEBUG || instance.config.debug
const Config = {
    DEBUG: false,
    LIB_VERSION: version,
}

export default Config
