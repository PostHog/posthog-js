import { version } from '../package.json'

// overriden in posthog-core,
// e.g.     Config.DEBUG = Config.DEBUG || instance.get_config('debug')
const Config = {
    DEBUG: false,
    LIB_VERSION: version,
}

export default Config
