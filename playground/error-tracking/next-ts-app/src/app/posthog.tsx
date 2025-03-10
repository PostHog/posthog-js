'use client'
import { useEffect } from 'react'
import { posthog } from 'posthog-js'

export function PosthogProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'http://localhost:8010',
            autocapture: false,
        })
    }, [])
    return <div>{children}</div>
}
