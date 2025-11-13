import { CaptureResult } from 'posthog-js'

export function EventDisplay({ events }: { events: CaptureResult[] }) {
    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                right: 0,
                width: '300px',
                maxHeight: '100vh',
                overflow: 'auto',
                backgroundColor: '#f5f5f5',
                border: '1px solid #ccc',
                padding: '10px',
                fontSize: '12px',
                zIndex: 1000,
            }}
        >
            <h3 style={{ margin: '0 0 10px 0' }}>Recent Events</h3>
            {events.length === 0 ? (
                <p>No events captured yet</p>
            ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {events.map((event, index) => (
                        <li
                            key={index}
                            style={{
                                marginBottom: '10px',
                                padding: '8px',
                                backgroundColor: 'white',
                                borderRadius: '4px',
                            }}
                        >
                            <strong>{event.event}</strong>
                            <div style={{ marginTop: '4px', color: '#666', fontSize: '10px' }}>
                                {new Date(event.timestamp || Date.now()).toLocaleTimeString()}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
