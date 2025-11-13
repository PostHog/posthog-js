import { usePostHog } from '@posthog/react'
import type { MetaFunction } from '@remix-run/node'

export const meta: MetaFunction = () => {
    return [
        { title: 'PostHog Remix Playground' },
        { name: 'description', content: 'Test PostHog integration with Remix' },
    ]
}

export default function Index() {
    const posthog = usePostHog()

    const handleCustomEvent = () => {
        posthog?.capture('custom_button_click', {
            location: 'homepage',
            timestamp: new Date().toISOString(),
        })
    }

    return (
        <div style={{ fontFamily: 'system-ui, sans-serif', lineHeight: '1.8', padding: '2rem' }}>
            <p>This is a basic Remix application with PostHog integration.</p>

            <div style={{ marginTop: '2rem' }}>
                <h2>Test PostHog Events</h2>
                <button
                    onClick={handleCustomEvent}
                    style={{
                        padding: '10px 20px',
                        fontSize: '16px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                    }}
                >
                    Send Custom Event
                </button>
            </div>

            <div style={{ marginTop: '2rem' }}>
                <h2>Features</h2>
                <ul>
                    <li>Automatic pageview tracking</li>
                    <li>Custom event capture</li>
                    <li>PostHog React hooks integration</li>
                    <li>Multiple example pages</li>
                </ul>
            </div>

            <div style={{ marginTop: '2rem' }}>
                <h2>Example Pages</h2>
                <ul>
                    <li>
                        <a href="/media">Media</a> - Base64 image testing for session replay
                    </li>
                </ul>
            </div>

            <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                <h3>Getting Started</h3>
                <ol>
                    <li>
                        Run <code>pnpm install</code> to install dependencies
                    </li>
                    <li>
                        Run <code>pnpm dev</code> to start the development server
                    </li>
                    <li>Open the browser console to see PostHog events</li>
                    <li>Navigate between pages to see pageview tracking</li>
                </ol>
            </div>
        </div>
    )
}
