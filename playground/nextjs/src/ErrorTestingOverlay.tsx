import { useState, useEffect } from 'react'
import { posthog } from './posthog'

export function ErrorTestingOverlay() {
    const [isMinimized, setIsMinimized] = useState(false)
    const [lastAction, setLastAction] = useState<string | null>(null)
    const [currentPath, setCurrentPath] = useState<string>('')

    useEffect(() => {
        setCurrentPath(window.location.pathname)

        // Update on navigation
        const updatePath = () => setCurrentPath(window.location.pathname)
        window.addEventListener('popstate', updatePath)
        return () => window.removeEventListener('popstate', updatePath)
    }, [])

    const throwUnhandledException = () => {
        setLastAction('Throwing unhandled exception...')
        setTimeout(() => {
            throw new Error('Test unhandled exception from ErrorTestingOverlay')
        }, 100)
    }

    const captureException = () => {
        setLastAction('Capturing exception via posthog.captureException()...')
        try {
            throw new Error('Test captured exception from ErrorTestingOverlay')
        } catch (e) {
            posthog.captureException(e)
        }
    }

    const captureEvent = (eventName: string) => {
        setLastAction(`Capturing event: ${eventName}`)
        posthog.capture(eventName)
    }

    if (isMinimized) {
        return (
            <div
                style={{
                    position: 'fixed',
                    bottom: '20px',
                    right: '20px',
                    zIndex: 99999,
                    backgroundColor: '#1a1a2e',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
                onClick={() => setIsMinimized(false)}
            >
                🐛 Error Testing
            </div>
        )
    }

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: 99999,
                backgroundColor: '#1a1a2e',
                color: 'white',
                padding: '16px',
                borderRadius: '12px',
                width: '320px',
                fontSize: '13px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                }}
            >
                <span style={{ fontWeight: 'bold', fontSize: '14px' }}>🐛 Error Testing</span>
                <button
                    onClick={() => setIsMinimized(true)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#888',
                        cursor: 'pointer',
                        fontSize: '18px',
                    }}
                >
                    −
                </button>
            </div>

            <div
                style={{
                    backgroundColor: '#2a2a4e',
                    padding: '8px',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    fontSize: '11px',
                    wordBreak: 'break-all',
                }}
            >
                <strong>URL:</strong> {currentPath}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Exceptions:</div>
                <button
                    onClick={throwUnhandledException}
                    style={{
                        padding: '10px 12px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500',
                    }}
                >
                    🔥 Throw Unhandled Exception
                </button>
                <button
                    onClick={captureException}
                    style={{
                        padding: '10px 12px',
                        backgroundColor: '#fd7e14',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500',
                    }}
                >
                    📸 Capture Exception
                </button>

                <div style={{ fontSize: '11px', color: '#888', marginTop: '8px', marginBottom: '4px' }}>
                    Trigger Event:
                </div>
                <button
                    onClick={() => captureEvent('custom_event_trigger_autocapture')}
                    style={{
                        padding: '10px 12px',
                        backgroundColor: '#6f42c1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500',
                    }}
                >
                    📡 Send Trigger Event
                </button>
            </div>

            {lastAction && (
                <div
                    style={{
                        marginTop: '12px',
                        padding: '8px',
                        backgroundColor: '#2a2a4e',
                        borderRadius: '6px',
                        fontSize: '11px',
                        color: '#aaa',
                    }}
                >
                    ✓ {lastAction}
                </div>
            )}
        </div>
    )
}
