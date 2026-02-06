'use client'

import { PostHogConfig } from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

const posthogConfig: Partial<PostHogConfig> = {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_API_HOST,
    debug: process.env.NODE_ENV === 'development',
    capture_exceptions: {
        capture_console_errors: true,
        capture_unhandled_rejections: true,
        capture_unhandled_errors: true,
    },
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
