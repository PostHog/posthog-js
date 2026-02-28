'use client'

import { useState } from 'react'
import { usePostHog } from '@posthog/next'

export default function CapturePage() {
    const posthog = usePostHog()
    const [events, setEvents] = useState<string[]>([])

    function capture(eventName: string, properties?: Record<string, unknown>) {
        posthog.capture(eventName, properties)
        setEvents((prev) => [...prev, `${eventName}${properties ? ' ' + JSON.stringify(properties) : ''}`])
    }

    return (
        <div>
            <h1 className="text-2xl font-bold mb-2">Event Capture</h1>
            <p className="text-gray-600 mb-6">
                Capture custom events using <code className="bg-gray-100 px-1 rounded">posthog.capture()</code>. Events
                appear in your PostHog project&#39;s activity feed.
            </p>

            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
                <h2 className="font-semibold mb-4">Capture Events</h2>
                <div className="flex gap-3 flex-wrap">
                    <button
                        onClick={() => capture('button_clicked')}
                        className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-700"
                    >
                        Basic Capture
                    </button>
                    <button
                        onClick={() => capture('button_clicked', { section: 'demo', variant: 'primary' })}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
                    >
                        With Properties
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="font-semibold mb-2">Event Log</h2>
                <p className="text-sm text-gray-500 mb-3">Events captured this session:</p>
                {events.length > 0 ? (
                    <ul className="space-y-1">
                        {events.map((event, i) => (
                            <li key={i} className="text-sm font-mono bg-gray-50 px-3 py-1.5 rounded">
                                {event}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-400">No events captured yet. Click a button above.</p>
                )}
            </div>
        </div>
    )
}
