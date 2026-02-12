/* eslint-env node */

import { withPostHogConfig } from '@posthog/nextjs-config'
import packageJson from './package.json' with { type: 'json' }

const nextConfig = {
    /* config options here */
}

export default withPostHogConfig(nextConfig, {
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!,
    projectId: process.env.POSTHOG_PROJECT_ID!,
    host: process.env.NEXT_PUBLIC_POSTHOG_API_HOST,
    cliBinaryPath: process.env.POSTHOG_CLI_PATH, // Optional
    logLevel: 'debug',
    sourcemaps: {
        releaseName: 'example-nextjs',
        releaseVersion: packageJson.version,
        deleteAfterUpload: true,
        batchSize: 50, // Optional. Default to 50
    },
})
