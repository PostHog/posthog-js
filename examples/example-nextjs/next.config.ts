import type { NextConfig } from 'next'
import { withPostHogConfig } from '@posthog/nextjs-config'
import { version } from './package.json'

const nextConfig: NextConfig = {
    /* config options here */
}

export default withPostHogConfig(nextConfig, {
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!,
    envId: process.env.POSTHOG_API_PROJECT!,
    host: process.env.NEXT_PUBLIC_POSTHOG_API_HOST!,
    verbose: true,
    sourcemaps: {
        project: 'example-nextjs',
        version,
    },
})
