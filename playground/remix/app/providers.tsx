import { useEffect, useState } from 'react'
import posthog, { CaptureResult } from 'posthog-js'
import { PostHogProvider } from '@posthog/react'
import { EventDisplay } from './EventDisplay'

export function PHProvider({ children }: { children: React.ReactNode }) {
    const [hydrated, setHydrated] = useState(false)
    const [events, setEvents] = useState<CaptureResult[]>([])

    useEffect(() => {
        posthog.init('phc_test_key_for_playground', {
            api_host: 'https://us.i.posthog.com',
            ui_host: 'https://us.posthog.com',
            defaults: '2025-11-30',
            before_send: (cr) => {
                setEvents((prev) => [cr!, ...prev].slice(0, 10))
                return cr
            },
        })

        setHydrated(true)
    }, [])

    if (!hydrated) return <>{children}</>
    return (
        <PostHogProvider client={posthog}>
            <EventDisplay events={events} />
            {children}
        </PostHogProvider>
    )
}
