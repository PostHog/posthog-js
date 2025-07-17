import baseConfig from './playwright.config'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

if (fs.existsSync(path.resolve(__dirname, '.env'))) {
    dotenv.config({ path: path.resolve(__dirname, '.env') })
}

export default {
    ...baseConfig,
    testDir: './playwright/integration',
    testIgnore: undefined,
}
