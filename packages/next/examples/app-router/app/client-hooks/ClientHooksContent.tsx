'use client'

import { usePostHog, useFeatureFlag, useActiveFeatureFlags } from '@posthog/next'

export default function ClientHooksContent() {
    const posthog = usePostHog()
    const exampleFlag = useFeatureFlag('example-flag')
    const activeFlags = useActiveFeatureFlags()

    return (
        <div>
            <h1 className="text-2xl font-bold mb-2">Client-Side Hooks</h1>
            <p className="text-gray-600 mb-6">
                These hooks from <code className="bg-gray-100 px-1 rounded">@posthog/next</code> provide real-time
                feature flag values on the client. Create a flag called{' '}
                <code className="bg-gray-100 px-1 rounded">example-flag</code> in your PostHog project to see values
                below.
            </p>

            <div className="space-y-4">
                <HookCard title="usePostHog()" description="Returns the PostHog client instance.">
                    <p className="text-sm">
                        Distinct ID:{' '}
                        <code className="bg-gray-100 px-1 rounded">{posthog?.get_distinct_id() ?? 'loading...'}</code>
                    </p>
                </HookCard>

                <HookCard title="useFeatureFlag('example-flag')">
                    <p className="text-sm">
                        Value: <code className="bg-gray-100 px-1 rounded">{JSON.stringify(exampleFlag, null, 2)}</code>
                    </p>
                </HookCard>

                <HookCard title="useActiveFeatureFlags()">
                    <p className="text-sm">
                        Active flags:{' '}
                        <code className="bg-gray-100 px-1 rounded">
                            {activeFlags && activeFlags.length > 0 ? activeFlags.join(', ') : 'none'}
                        </code>
                    </p>
                </HookCard>
            </div>
        </div>
    )
}

function HookCard({
    title,
    description,
    children,
}: {
    title: string
    description?: string
    children: React.ReactNode
}) {
    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="font-semibold font-mono text-sm mb-2">{title}</h2>
            {description && <p className="text-sm text-gray-500 mb-2">{description}</p>}
            {children}
        </div>
    )
}
