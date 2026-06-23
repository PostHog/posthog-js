'use client'

import { useState } from 'react'

export default function ServerErrorsPage() {
    const [status, setStatus] = useState<string>('No server error triggered yet.')

    async function triggerServerError() {
        setStatus('Triggering /api/server-error...')
        try {
            const response = await fetch('/api/server-error')
            setStatus(`Server responded with ${response.status}. Check PostHog for a $exception event.`)
        } catch (error) {
            setStatus(`Request failed: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    return (
        <div>
            <h1 className="text-2xl font-bold mb-2">Server-Side Error Capture</h1>
            <p className="text-gray-600 mb-6">
                This example uses <code className="bg-gray-100 px-1 rounded">instrumentation.ts</code> to export{' '}
                <code className="bg-gray-100 px-1 rounded">onRequestError</code> from{' '}
                <code className="bg-gray-100 px-1 rounded">@posthog/next</code>. Next.js calls that hook when a request
                throws on the server, and PostHog captures the exception with the current PostHog cookie identity when
                available.
            </p>

            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
                <h2 className="font-semibold mb-4">Trigger a server exception</h2>
                <button
                    onClick={triggerServerError}
                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500"
                >
                    Throw from route handler
                </button>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="font-semibold mb-2">Status</h2>
                <p className="text-sm text-gray-600">{status}</p>
            </div>
        </div>
    )
}
