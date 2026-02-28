export default function MiddlewareDemoPage() {
    return (
        <div>
            <h1 className="text-2xl font-bold mb-2">Middleware Rewrites</h1>
            <p className="text-gray-600 mb-6">
                This page uses <code className="bg-gray-100 px-1 rounded">postHogMiddleware</code> from{' '}
                <code className="bg-gray-100 px-1 rounded">@posthog/next/middleware</code> to rewrite URLs based on
                feature flag values.
            </p>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="font-semibold mb-2">You&#39;re seeing the default page</h2>
                <p className="text-sm text-gray-600 mb-4">
                    The <code className="bg-gray-100 px-1 rounded">new-landing</code> flag is either not set or
                    evaluates to <code className="bg-gray-100 px-1 rounded">false</code> for your user.
                </p>
                <div className="bg-gray-50 rounded p-4 text-sm">
                    <p className="font-medium mb-2">To test the rewrite:</p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-600">
                        <li>Go to your PostHog project</li>
                        <li>
                            Create a boolean feature flag called{' '}
                            <code className="bg-gray-100 px-1 rounded">new-landing</code>
                        </li>
                        <li>Enable it for your user (or set it to 100% rollout)</li>
                        <li>Refresh this page</li>
                    </ol>
                </div>
            </div>
        </div>
    )
}
