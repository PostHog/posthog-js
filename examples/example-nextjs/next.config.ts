import { withPostHogConfig } from '@posthog/nextjs-config'
import packageJson from './package.json' with { type: 'json' }

const nextConfig = {
    /* config options here */
}

export default withPostHogConfig(nextConfig, {
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!,
    envId: process.env.POSTHOG_API_PROJECT!,
    host: process.env.NEXT_PUBLIC_POSTHOG_API_HOST!,
    logLevel: 'debug',
    sourcemaps: {
        project: 'example-nextjs',
        version: packageJson.version,
    },
})
