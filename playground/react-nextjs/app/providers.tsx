'use client'

import posthog, { CaptureResult } from 'posthog-js'
import { PostHogProvider } from '@posthog/react'
import { useEffect, useState } from 'react'
import { EventDisplay } from './components/EventDisplay'

let eventListeners: ((event: CaptureResult | null) => void)[] = []

export function addEventListener(callback: (event: CaptureResult | null) => void) {
    eventListeners.push(callback)
    return () => {
        eventListeners = eventListeners.filter((cb) => cb !== callback)
    }
}

if (typeof window !== 'undefined') {
    posthog.init('phc_test_key_for_playground', {
        api_host: 'https://us.i.posthog.com',
        person_profiles: 'always',
        capture_pageview: false,
        capture_pageleave: true,
        before_send: (event) => {
            eventListeners.forEach((callback) => callback(event))
            console.log('Yo! An event', event)
            return event
        },
    })
}

export function PHProvider({ children }: { children: React.ReactNode }) {
    const [events, setEvents] = useState<CaptureResult[]>([])

    useEffect(() => {
        const removeListener = addEventListener((event) => {
            if (!event) {
                return
            }
            setEvents((prev) => [event, ...prev].slice(0, 10))
        })

        posthog.capture('playground_loaded')

        return removeListener
    }, [])

    return (
        <PostHogProvider client={posthog}>
            <EventDisplay events={events} />
            {children}
        </PostHogProvider>
    )
}
