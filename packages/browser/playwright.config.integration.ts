import baseConfig from './playwright.config'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { devices } from '@playwright/test'

if (fs.existsSync(path.resolve(__dirname, '.env'))) {
    dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true })
}

export default {
    ...baseConfig,
    retries: process.env.CI ? 4 : 0,
    testDir: './playwright/integration',
    projects: [
        ...(baseConfig.projects || []),
        {
            name: 'msedge',
            use: {
                ...devices['Desktop Edge'],
                staticOverrides: {
                    'array.full.js': 'array.full.es5.js',
                },
            },
        },
    ],
}
