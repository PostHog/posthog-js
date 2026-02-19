import Link from 'next/link'

const demos = [
    {
        title: 'Authentication',
        href: '/auth',
        description:
            'Log in and out with posthog.identify() and posthog.reset(). Shows identity sync between client and server.',
    },
    {
        title: 'Server-Side Flags',
        href: '/server-flags',
        description: 'Evaluate feature flags in server components using PostHogServer.',
    },
    {
        title: 'Client Hooks',
        href: '/client-hooks',
        description: 'Use React hooks like useFeatureFlagEnabled and useActiveFeatureFlags.',
    },
    {
        title: 'Event Capture',
        href: '/capture',
        description: 'Capture custom events from client components with posthog.capture().',
    },
    {
        title: 'Middleware Rewrites',
        href: '/middleware-demo',
        description: 'Flag-based URL rewrites at the edge using postHogMiddleware.',
    },
]

export default function Home() {
    return (
        <div>
            <h1 className="text-3xl font-bold mb-2">@posthog/next Example</h1>
            <p className="text-gray-600 mb-8">
                Explore each demo to see how @posthog/next integrates with Next.js App Router.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
                {demos.map((demo) => (
                    <Link
                        key={demo.href}
                        href={demo.href}
                        className="block p-6 bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
                    >
                        <h2 className="font-semibold mb-1">{demo.title}</h2>
                        <p className="text-sm text-gray-600">{demo.description}</p>
                    </Link>
                ))}
            </div>
        </div>
    )
}
