'use client'

import { CaptureResult } from 'posthog-js'
import { useState, useEffect } from 'react'

interface EventDisplayProps {
    events: CaptureResult[]
}

interface EventWithTimestamp extends CaptureResult {
    capturedAt: number
}

export function EventDisplay({ events }: EventDisplayProps) {
    const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
    const [eventsWithTimestamp, setEventsWithTimestamp] = useState<EventWithTimestamp[]>([])
    const [, setTick] = useState(0)

    useEffect(() => {
        const newEvents = events.filter((e) => !eventsWithTimestamp.find((existing) => existing.uuid === e.uuid))
        if (newEvents.length > 0) {
            setEventsWithTimestamp((prev) => [...prev, ...newEvents.map((e) => ({ ...e, capturedAt: Date.now() }))])
        }
    }, [events, eventsWithTimestamp])

    useEffect(() => {
        const interval = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(interval)
    }, [])

    const toggleExpanded = (uuid: string) => {
        setExpandedEvents((prev) => {
            const next = new Set(prev)
            if (next.has(uuid)) {
                next.delete(uuid)
            } else {
                next.add(uuid)
            }
            return next
        })
    }

    const getTimeAgo = (timestamp: number) => {
        const seconds = Math.floor((Date.now() - timestamp) / 1000)
        if (seconds < 60) return `${seconds}s ago`
        const minutes = Math.floor(seconds / 60)
        if (minutes < 60) return `${minutes}m ago`
        const hours = Math.floor(minutes / 60)
        return `${hours}h ago`
    }

    return (
        <div
            style={{
                position: 'fixed',
                top: '1rem',
                right: '1rem',
                width: '320px',
                maxHeight: '400px',
                overflowY: 'scroll',
                backgroundColor: 'white',
                border: '2px solid #d1d5db',
                borderRadius: '8px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                padding: '1rem',
                zIndex: 50,
            }}
        >
            <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.75rem', color: '#1f2937' }}>
                PostHog Events
            </h2>
            {eventsWithTimestamp.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>No events captured yet...</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {eventsWithTimestamp.map((event) => (
                        <div
                            key={event.uuid}
                            style={{
                                backgroundColor: '#f9fafb',
                                border: '1px solid #e5e7eb',
                                borderRadius: '4px',
                                padding: '0.5rem',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                            }}
                            onClick={() => toggleExpanded(event.uuid)}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}
                            >
                                <div style={{ fontWeight: '600', color: '#2563eb' }}>{event.event}</div>
                                <div style={{ color: '#9ca3af', fontSize: '0.65rem' }}>
                                    {getTimeAgo(event.capturedAt)}
                                </div>
                            </div>
                            {expandedEvents.has(event.uuid) && (
                                <div
                                    style={{
                                        marginTop: '0.5rem',
                                        paddingTop: '0.5rem',
                                        borderTop: '1px solid #e5e7eb',
                                    }}
                                >
                                    <pre
                                        style={{
                                            fontSize: '0.65rem',
                                            color: '#374151',
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word',
                                        }}
                                    >
                                        {JSON.stringify(event.properties, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
