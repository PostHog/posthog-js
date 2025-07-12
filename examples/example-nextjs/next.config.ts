import type { NextConfig } from 'next'
import { withPostHogConfig } from '@posthog/nextjs-config'

const nextConfig: NextConfig = {
    /* config options here */
}

export default withPostHogConfig(nextConfig, {
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!,
    envId: '1',
    host: 'http://localhost:8010',
})
