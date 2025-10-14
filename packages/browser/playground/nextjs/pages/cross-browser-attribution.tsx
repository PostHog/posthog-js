import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'

export default function CrossBrowserAttribution() {
    const posthog = usePostHog()
    const [trackingUrl, setTrackingUrl] = useState('')
    const [isBootstrapped, setIsBootstrapped] = useState(false)
    const [sessionInfo, setSessionInfo] = useState({
        distinctId: '',
        sessionId: '',
        isIdentified: false,
    })
    const [sessionProps, setSessionProps] = useState<Record<string, any>>({})

    useEffect(() => {
        if (!posthog) return

        // Update session info
        setSessionInfo({
            distinctId: posthog.get_distinct_id(),
            sessionId: posthog.get_session_id(),
            isIdentified: posthog.isIdentified(),
        })

        // Update session properties (attribution data)
        setSessionProps(posthog.get_session_properties())

        // Check if we were bootstrapped from URL
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search)
            if (params.has('__ph_distinct_id') || params.has('__ph_session_entry_utm_source')) {
                setIsBootstrapped(true)
                // Clean up URL after bootstrap
                window.history.replaceState({}, '', window.location.pathname)
            }
        }
    }, [posthog])

    const generateTrackingUrl = () => {
        if (typeof window === 'undefined' || !posthog) return

        const baseUrl = window.location.origin + window.location.pathname
        // eslint-disable-next-line compat/compat
        const url = new URL(baseUrl)

        url.searchParams.set('__ph_distinct_id', posthog.get_distinct_id())
        url.searchParams.set('__ph_session_id', posthog.get_session_id())
        url.searchParams.set('__ph_is_identified', posthog.isIdentified() ? 'true' : 'false')

        // Add session entry properties to preserve attribution
        const sessionProperties = posthog.get_session_properties()
        Object.entries(sessionProperties).forEach(([key, value]) => {
            if (key.startsWith('$session_entry_')) {
                const paramName = '__ph_session_entry_' + key.replace('$session_entry_', '')
                url.searchParams.set(paramName, String(value))
            }
        })

        setTrackingUrl(url.toString())
    }

    const copyUrl = () => {
        if (trackingUrl) {
            navigator.clipboard.writeText(trackingUrl)
            alert('URL copied to clipboard!')
        }
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-4">Cross-Browser Attribution Demo</h1>

            {isBootstrapped && (
                <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
                    ✅ Session successfully bootstrapped from URL! Check the Activity tab - this should appear as the
                    same user.
                </div>
            )}

            <div className="bg-gray-100 p-4 rounded mb-6">
                <h2 className="text-xl font-semibold mb-3">Current Session Info</h2>
                <div className="space-y-2 font-mono text-sm">
                    <div>
                        <span className="font-semibold">Distinct ID:</span>
                        <code className="bg-white px-2 py-1 rounded ml-2">{sessionInfo.distinctId}</code>
                    </div>
                    <div>
                        <span className="font-semibold">Session ID:</span>
                        <code className="bg-white px-2 py-1 rounded ml-2">{sessionInfo.sessionId}</code>
                    </div>
                    <div>
                        <span className="font-semibold">Is Identified:</span>
                        <code className="bg-white px-2 py-1 rounded ml-2">{sessionInfo.isIdentified.toString()}</code>
                    </div>
                </div>
            </div>

            <div className="bg-gray-100 p-4 rounded mb-6">
                <h2 className="text-xl font-semibold mb-3">Session Properties (Attribution Data)</h2>
                {Object.keys(sessionProps).length > 0 ? (
                    <div className="space-y-2 font-mono text-sm">
                        {Object.entries(sessionProps).map(([key, value]) => (
                            <div key={key}>
                                <span className="font-semibold">{key}:</span>
                                <code className="bg-white px-2 py-1 rounded ml-2">{String(value)}</code>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-gray-600">
                        No session properties yet. Navigate from a page with UTM parameters or bootstrap from a URL with
                        session properties.
                    </p>
                )}
            </div>

            <div className="mb-6">
                <h2 className="text-xl font-semibold mb-3">Test Cross-Browser Attribution</h2>
                <p className="mb-4 text-gray-700">
                    Click the button below to generate a tracking URL. Copy it and open in:
                </p>
                <ul className="list-disc list-inside mb-4 text-gray-700">
                    <li>Incognito/private window</li>
                    <li>Different browser</li>
                    <li>Another device</li>
                </ul>
                <button
                    onClick={generateTrackingUrl}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mb-4"
                >
                    Generate Tracking URL
                </button>
            </div>

            {trackingUrl && (
                <div className="bg-yellow-50 border border-yellow-300 p-4 rounded">
                    <h3 className="font-semibold mb-2">Test URL:</h3>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={trackingUrl}
                            readOnly
                            className="flex-1 p-2 border rounded font-mono text-sm"
                        />
                        <button
                            onClick={copyUrl}
                            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
                        >
                            Copy
                        </button>
                    </div>
                    <p className="text-sm text-gray-600 mt-2">
                        Open this URL in another browser/incognito tab. The session will continue with the same IDs.
                    </p>
                </div>
            )}

            <div className="mt-8 bg-blue-50 border border-blue-300 p-4 rounded">
                <h3 className="font-semibold mb-2">How it works:</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                    <li>
                        PostHog is initialized with{' '}
                        <code className="bg-white px-1 rounded">enable_bootstrap_from_url: true</code>
                    </li>
                    <li>
                        When you click &quot;Generate&quot;, URL params are added:{' '}
                        <code className="bg-white px-1 rounded">__ph_distinct_id</code>,{' '}
                        <code className="bg-white px-1 rounded">__ph_session_id</code>,{' '}
                        <code className="bg-white px-1 rounded">__ph_is_identified</code>
                    </li>
                    <li>
                        Session properties (UTM parameters, referrer, etc.) are added as{' '}
                        <code className="bg-white px-1 rounded">__ph_session_entry_*</code> params
                    </li>
                    <li>Opening the URL in another browser reads these params and continues the session</li>
                    <li>All events are attributed to the same user with preserved session properties</li>
                </ol>
            </div>

            <div className="mt-4 bg-purple-50 border border-purple-300 p-4 rounded">
                <h3 className="font-semibold mb-2">Example Use Case:</h3>
                <p className="text-sm text-gray-700 mb-2">
                    A user lands on your marketing site from Google Ads (UTM parameters captured). They click a link to
                    your booking site. Without session bootstrapping, the UTM data is lost.
                </p>
                <p className="text-sm text-gray-700">
                    <strong>With session bootstrapping:</strong> The marketing site builds a URL with{' '}
                    <code className="bg-white px-1 rounded">__ph_session_entry_utm_source=google</code>,{' '}
                    <code className="bg-white px-1 rounded">__ph_session_entry_utm_campaign=summer_sale</code>, etc.
                    Events on the booking site maintain the same attribution data!
                </p>
            </div>
        </div>
    )
}
