import { usePostHog } from 'posthog-js/react'
import { useState } from 'react'

type Page = 'page-a' | 'page-b'

const ExceptionAutocapture = () => {
    const posthog = usePostHog()
    const [currentPage, setCurrentPage] = useState<Page>('page-a')

    const handleManualCapture = () => {
        posthog.captureException(new Error('Manual exception capture test'))
    }

    const handleThrowUnhandled = () => {
        // This will throw an unhandled exception
        setTimeout(() => {
            throw new Error('Unhandled exception test')
        }, 0)
    }

    const handleThrowUnhandledPromise = () => {
        // This will create an unhandled promise rejection
        Promise.reject(new Error('Unhandled promise rejection test'))
    }

    const handleConsoleError = () => {
        // eslint-disable-next-line no-console
        console.error(new Error('Console error test'))
    }

    const handleTriggerEvent = () => {
        posthog.capture('exception_trigger_event')
    }

    const handleCustomTriggerEvent = (eventName: string) => {
        posthog.capture(eventName)
    }

    const navigateToPage = (page: Page) => {
        const newUrl = `${window.location.pathname}?page=${page}`
        window.history.pushState({}, '', newUrl)
        setCurrentPage(page)
    }

    return (
        <div className="max-w-2xl mx-auto p-6 space-y-8">
            <h1 className="text-2xl font-bold">Exception Autocapture Test</h1>

            {/* Manual Capture Section */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold border-b pb-2">1. Manual Exception Capture</h2>
                <p className="text-gray-600 text-sm">
                    This calls <code>posthog.captureException()</code> directly. Should NOT be affected by autocapture
                    controls.
                </p>
                <button
                    onClick={handleManualCapture}
                    className="bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-5 py-2.5"
                >
                    Capture Exception Manually
                </button>
            </section>

            {/* Unhandled Exceptions Section */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold border-b pb-2">2. Unhandled Exceptions (Autocapture)</h2>
                <p className="text-gray-600 text-sm">
                    These throw real unhandled exceptions. Should be affected by autocapture controls.
                </p>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={handleThrowUnhandled}
                        className="bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg px-5 py-2.5"
                    >
                        Throw Unhandled Error
                    </button>
                    <button
                        onClick={handleThrowUnhandledPromise}
                        className="bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg px-5 py-2.5"
                    >
                        Unhandled Promise Rejection
                    </button>
                    <button
                        onClick={handleConsoleError}
                        className="bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg px-5 py-2.5"
                    >
                        Console Error
                    </button>
                </div>
            </section>

            {/* Trigger Events Section */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold border-b pb-2">3. Trigger Events</h2>
                <p className="text-gray-600 text-sm">
                    Send events that can be configured as triggers for exception autocapture.
                </p>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={handleTriggerEvent}
                        className="bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg px-5 py-2.5"
                    >
                        Send &quot;exception_trigger_event&quot;
                    </button>
                    <button
                        onClick={() => handleCustomTriggerEvent('error_tracking_trigger')}
                        className="bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg px-5 py-2.5"
                    >
                        Send &quot;error_tracking_trigger&quot;
                    </button>
                    <button
                        onClick={() => handleCustomTriggerEvent('custom_trigger')}
                        className="bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg px-5 py-2.5"
                    >
                        Send &quot;custom_trigger&quot;
                    </button>
                </div>
            </section>

            {/* URL Trigger Section */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold border-b pb-2">4. URL Triggers</h2>
                <p className="text-gray-600 text-sm">
                    Switch between pages to test URL-based triggers. Current URL:{' '}
                    <code className="bg-gray-100 px-1 rounded">?page={currentPage}</code>
                </p>
                <div className="flex gap-4">
                    <div
                        className={`flex-1 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                            currentPage === 'page-a'
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-300 hover:border-gray-400'
                        }`}
                        onClick={() => navigateToPage('page-a')}
                    >
                        <h3 className="font-semibold">Page A</h3>
                        <p className="text-sm text-gray-600">URL: ?page=page-a</p>
                        {currentPage === 'page-a' && (
                            <span className="inline-block mt-2 text-xs bg-purple-500 text-white px-2 py-1 rounded">
                                Current
                            </span>
                        )}
                    </div>
                    <div
                        className={`flex-1 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                            currentPage === 'page-b'
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-300 hover:border-gray-400'
                        }`}
                        onClick={() => navigateToPage('page-b')}
                    >
                        <h3 className="font-semibold">Page B</h3>
                        <p className="text-sm text-gray-600">URL: ?page=page-b</p>
                        {currentPage === 'page-b' && (
                            <span className="inline-block mt-2 text-xs bg-purple-500 text-white px-2 py-1 rounded">
                                Current
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex gap-2 mt-4">
                    <button
                        onClick={() => {
                            window.history.pushState({}, '', '/exception-autocapture?page=trigger-url')
                            setCurrentPage('page-a')
                        }}
                        className="bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg px-5 py-2.5"
                    >
                        Go to ?page=trigger-url
                    </button>
                    <button
                        onClick={() => {
                            window.history.pushState({}, '', '/exception-autocapture?page=blocked-url')
                            setCurrentPage('page-a')
                        }}
                        className="bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg px-5 py-2.5"
                    >
                        Go to ?page=blocked-url
                    </button>
                </div>
            </section>

            {/* Info Section */}
            <section className="bg-gray-100 rounded-lg p-4 text-sm">
                <h3 className="font-semibold mb-2">How to test:</h3>
                <ol className="list-decimal list-inside space-y-1 text-gray-700">
                    <li>Configure autocapture controls in your PostHog project settings</li>
                    <li>Set up URL triggers (e.g., match &quot;page-b&quot; or &quot;trigger-url&quot;)</li>
                    <li>Set up event triggers (e.g., &quot;exception_trigger_event&quot;)</li>
                    <li>Set up sample rates or feature flags as needed</li>
                    <li>Use the buttons above to test different scenarios</li>
                    <li>Check the browser console and PostHog dashboard for results</li>
                </ol>
            </section>
        </div>
    )
}

export default ExceptionAutocapture
