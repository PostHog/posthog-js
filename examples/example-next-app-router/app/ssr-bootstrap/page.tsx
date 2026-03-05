'use client'

import { useFeatureFlag, useActiveFeatureFlags } from '@posthog/next'

export default function SSRBootstrapPage() {
    // These values are available immediately on first render - no flicker.
    // The PostHogProvider in layout.tsx has `bootstrapFlags` enabled, which
    // evaluates flags server-side and passes them to the client via bootstrap.
    const activeFlags = useActiveFeatureFlags()
    const exampleFlag = useFeatureFlag('example-flag')

    return (
        <div>
            <h1 className="text-2xl font-bold mb-2">SSR Bootstrapped Feature Flags</h1>
            <p className="text-gray-600 mb-6">
                This page uses client-side hooks (<code className="bg-gray-100 px-1 rounded">useFeatureFlag</code>
                ), but because the layout has <code className="bg-gray-100 px-1 rounded">bootstrapFlags</code> enabled,
                flag values are available on the first render with no flicker.
            </p>

            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
                <h2 className="font-semibold mb-2">Example Flag</h2>
                <pre className="bg-gray-50 p-3 rounded text-sm overflow-auto">
                    {JSON.stringify(exampleFlag, null, 2) ?? 'undefined'}
                </pre>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="font-semibold mb-2">Active Feature Flags</h2>
                {activeFlags && activeFlags.length > 0 ? (
                    <ul className="text-sm space-y-1">
                        {activeFlags.map((flag) => (
                            <li key={flag} className="font-mono">
                                {flag}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-500">
                        No active flags. Create some in your PostHog project to see them here.
                    </p>
                )}
            </div>
        </div>
    )
}
