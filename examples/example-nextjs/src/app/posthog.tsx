'use client'

import { PostHogConfig } from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

const posthogConfig: Partial<PostHogConfig> = {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_API_HOST,
    debug: process.env.NODE_ENV === 'development',
}

export default function PHProvider({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <PostHogProvider apiKey={process.env.NEXT_PUBLIC_POSTHOG_PROJECT_API_KEY!} options={posthogConfig}>
            {children}
        </PostHogProvider>
    )
}
