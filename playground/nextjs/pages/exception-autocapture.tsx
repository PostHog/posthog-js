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
        setTimeout(() => {
            throw new Error('Unhandled exception test')
        }, 0)
    }

    const handleTriggerEvent = () => {
        posthog.capture('exception_trigger_event')
    }

    const navigateToPage = (page: Page) => {
        const newUrl = `${window.location.pathname}?page=${page}`
        window.history.pushState({}, '', newUrl)
        setCurrentPage(page)
    }

    return (
        <div className="max-w-2xl mx-auto p-6 space-y-8">
            <h1 className="text-2xl font-bold">Exception Autocapture Test</h1>

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

            <section className="space-y-4">
                <h2 className="text-xl font-semibold border-b pb-2">2. Unhandled Exceptions (Autocapture)</h2>
                <p className="text-gray-600 text-sm">
                    This throws a real unhandled exception. Should be affected by autocapture controls.
                </p>
                <button
                    onClick={handleThrowUnhandled}
                    className="bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg px-5 py-2.5"
                >
                    Throw Unhandled Error
                </button>
            </section>

            <section className="space-y-4">
                <h2 className="text-xl font-semibold border-b pb-2">3. Trigger Events</h2>
                <p className="text-gray-600 text-sm">
                    Send events that can be configured as triggers for exception autocapture.
                </p>
                <button
                    onClick={handleTriggerEvent}
                    className="bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg px-5 py-2.5"
                >
                    Send &quot;exception_trigger_event&quot;
                </button>
            </section>

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
            </section>
        </div>
    )
}

export default ExceptionAutocapture
