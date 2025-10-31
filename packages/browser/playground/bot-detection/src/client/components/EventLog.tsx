import { useEffect, useRef, useState } from 'react'
import { CapturedEvent } from '../types'
import { EventCard } from './EventCard'

interface EventLogProps {
    events: CapturedEvent[]
    onClear: () => void
}

export function EventLog({ events, onClear }: EventLogProps) {
    const [autoScroll, setAutoScroll] = useState(true)
    const logContentRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (autoScroll && logContentRef.current) {
            logContentRef.current.scrollTop = logContentRef.current.scrollHeight
        }
    }, [events, autoScroll])

    return (
        <div className="event-log-container">
            <div className="event-log">
                <div className="event-log-header">
                    <div className="event-log-title">
                        Event Log
                        <span className="event-count">{events.length}</span>
                    </div>
                    <div className="event-log-controls">
                        <button
                            className={`btn-small ${autoScroll ? 'active' : ''}`}
                            onClick={() => setAutoScroll(!autoScroll)}
                        >
                            {autoScroll ? '✓ ' : ''}Auto-scroll
                        </button>
                        <button className="btn-small" onClick={onClear}>
                            🗑️ Clear
                        </button>
                    </div>
                </div>
                <div className="event-log-content" ref={logContentRef}>
                    {events.length === 0 ? (
                        <div className="event-log-empty">
                            <div className="event-log-empty-icon">📭</div>
                            <div>No events captured yet</div>
                            <div style={{ fontSize: '12px', marginTop: '5px' }}>Click a button to send an event</div>
                        </div>
                    ) : (
                        events.map((event) => <EventCard key={event.id} event={event} />)
                    )}
                </div>
            </div>
        </div>
    )
}
