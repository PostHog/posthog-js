/* eslint-env node */
import posthog from '@posthog/rollup-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
    plugins: [
        posthog({
            personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!,
            envId: process.env.POSTHOG_PROJECT_ID!,
            host: process.env.POSTHOG_API_HOST,
            sourcemaps: {
                enabled: true,
                deleteAfterUpload: false,
            },
        }),
    ],
})
