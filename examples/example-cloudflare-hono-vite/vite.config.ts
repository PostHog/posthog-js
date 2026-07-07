import { cloudflare } from '@cloudflare/vite-plugin'
import posthog from '@posthog/rollup-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
    plugins: [
        cloudflare(),
        posthog({
            secretKey: process.env.POSTHOG_SECRET_KEY!,
            projectId: process.env.POSTHOG_PROJECT_ID!,
            host: process.env.POSTHOG_API_HOST,
            sourcemaps: {
                enabled: true,
                deleteAfterUpload: false,
            },
        }),
    ],
})
