export default function MiddlewareVariantPage() {
    return (
        <div>
            <h1 className="text-2xl font-bold mb-2">Middleware Rewrites</h1>
            <p className="text-gray-600 mb-6">
                This page uses <code className="bg-gray-100 px-1 rounded">postHogMiddleware</code> from{' '}
                <code className="bg-gray-100 px-1 rounded">@posthog/next/middleware</code> to rewrite URLs based on
                feature flag values.
            </p>

            <div className="bg-green-50 rounded-lg border border-green-200 p-6">
                <h2 className="font-semibold mb-2 text-green-900">You&#39;re seeing the variant!</h2>
                <p className="text-sm text-green-800">
                    The <code className="bg-green-100 px-1 rounded">new-landing</code> flag evaluated to{' '}
                    <code className="bg-green-100 px-1 rounded">true</code> for your user. The middleware rewrote{' '}
                    <code className="bg-green-100 px-1 rounded">/middleware-demo</code> to{' '}
                    <code className="bg-green-100 px-1 rounded">/middleware-demo/variant</code> transparently.
                </p>
                <p className="text-sm text-green-700 mt-2">
                    Notice the URL bar still shows <code className="bg-green-100 px-1 rounded">/middleware-demo</code> —
                    the rewrite is invisible to the user.
                </p>
            </div>
        </div>
    )
}
