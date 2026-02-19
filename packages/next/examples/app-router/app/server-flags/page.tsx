import Link from 'next/link'
import { cookies } from 'next/headers'
import { phServer } from '@/lib/posthog'

export const dynamic = 'force-dynamic'

export default async function ServerFlagsPage() {
    const ph = phServer.getClient(await cookies())
    const distinctId = ph.getDistinctId()
    const allFlags = await ph.getAllFlags()

    ph.capture('server_flags_page_viewed')

    return (
        <div>
            <h1 className="text-2xl font-bold mb-2">Server-Side Feature Flags</h1>
            <p className="text-gray-600 mb-6">
                This page is a server component. It uses <code className="bg-gray-100 px-1 rounded">PostHogServer</code>{' '}
                from <code className="bg-gray-100 px-1 rounded">@posthog/next/server</code> to evaluate feature flags
                and capture events server-side.
            </p>

            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
                <h2 className="font-semibold mb-2">Identity</h2>
                <p className="text-sm">
                    Distinct ID: <code className="bg-gray-100 px-1 rounded">{distinctId}</code>
                </p>
                <p className="text-sm text-gray-500 mt-1">
                    This ID is read from the PostHog cookie set by posthog-js on the client. Try logging in on the{' '}
                    <Link href="/auth" className="text-blue-600 underline">
                        Auth page
                    </Link>{' '}
                    and refreshing this page to see the identity change.
                </p>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="font-semibold mb-2">All Feature Flags</h2>
                {Object.keys(allFlags).length > 0 ? (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2">Flag</th>
                                <th className="text-left py-2">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(allFlags).map(([key, value]) => (
                                <tr key={key} className="border-b last:border-0">
                                    <td className="py-2 font-mono">{key}</td>
                                    <td className="py-2">{String(value)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <p className="text-sm text-gray-500">
                        No feature flags found. Create some flags in your PostHog project to see them here.
                    </p>
                )}
            </div>
        </div>
    )
}
