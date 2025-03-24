'use client'
import { useEffect } from 'react'
import { posthog } from 'posthog-js'

export function PosthogProvider({ children, debug = false }: { children: React.ReactNode; debug?: boolean }) {
    useEffect(() => {
        posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'http://localhost:8010',
            autocapture: true,
        })
        if (debug) {
            posthog.debug()
        }
    }, [])
    return <>{children}</>
}
