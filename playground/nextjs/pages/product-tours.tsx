import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'
import { ProductTour } from 'posthog-js'

export default function ProductTours() {
    const posthog = usePostHog()
    const [tours, setTours] = useState<ProductTour[]>([])
    const [selectedTourId, setSelectedTourId] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        try {
            posthog?.productTours?.getProductTours((fetchedTours: ProductTour[]) => {
                setLoading(false)
                setTours(fetchedTours)
                if (fetchedTours.length > 0) {
                    setSelectedTourId(fetchedTours[0].id)
                }
            })
        } catch (error: any) {
            setError(error)
        }
    }, [posthog])

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedTourId(event.target.value)
    }

    const handleLaunchTour = () => {
        console.log('has it?', posthog?.productTours)
        if (selectedTourId && posthog?.productTours) {
            console.log(`showing tour ${selectedTourId}`)
            posthog.productTours.showProductTour(selectedTourId)
        }
    }

    const handleResetTour = () => {
        if (selectedTourId && posthog?.productTours) {
            posthog.productTours.resetTour(selectedTourId)
            alert(`Tour "${selectedTourId}" reset. It can now be shown again.`)
        }
    }

    const handleResetAllTours = () => {
        if (posthog?.productTours) {
            posthog.productTours.resetAllTours()
            alert('All tours reset. They can now be shown again.')
        }
    }

    const selectedTour = tours.find((t) => t.id === selectedTourId)

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div id="playground-banner-container"></div>

            <h1 className="text-2xl font-bold mb-6">Product Tours Playground</h1>

            {/* Tour Controls */}
            <div className="bg-gray-100 p-4 rounded-lg mb-8">
                <h2 className="text-lg font-semibold mb-4">Tour Controls</h2>

                {loading ? (
                    <p>Loading tours...</p>
                ) : error ? (
                    <p className="text-red-500">Error: {error}</p>
                ) : tours.length === 0 ? (
                    <p>No tours found. Create a tour using the toolbar first!</p>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4 flex-wrap">
                            <select
                                value={selectedTourId}
                                onChange={handleChange}
                                className="border border-gray-300 rounded px-3 py-2 min-w-[200px]"
                            >
                                <option value="">Select a tour</option>
                                {tours.map((tour) => (
                                    <option key={tour.id} value={tour.id}>
                                        {tour.name} ({tour.steps?.length || 0} steps)
                                    </option>
                                ))}
                            </select>

                            <button
                                onClick={handleLaunchTour}
                                disabled={!selectedTourId}
                                className="bg-blue-600 text-white px-4 py-2 rounded disabled:bg-gray-400 hover:bg-blue-700"
                            >
                                Launch Tour
                            </button>

                            <button
                                onClick={handleResetTour}
                                disabled={!selectedTourId}
                                className="bg-gray-600 text-white px-4 py-2 rounded disabled:bg-gray-400 hover:bg-gray-700"
                            >
                                Reset Tour
                            </button>

                            <button
                                onClick={handleResetAllTours}
                                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                            >
                                Reset All Tours
                            </button>
                        </div>

                        {selectedTour && (
                            <div className="text-sm text-gray-600">
                                <p>
                                    <strong>Selected:</strong> {selectedTour.name}
                                </p>
                                <p>
                                    <strong>Steps:</strong> {selectedTour.steps?.length || 0}
                                </p>
                                {selectedTour.steps?.map((step, i) => (
                                    <p key={step.id} className="ml-4">
                                        Step {i + 1}: <code className="bg-gray-200 px-1">{step.selector}</code>
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Demo Elements for Tours */}
            <div className="space-y-8">
                <h2 className="text-lg font-semibold">Demo Elements (for creating tours)</h2>
                <p className="text-gray-600 text-sm">
                    Use the toolbar to create tours targeting these elements. Each has a unique ID for easy selection.
                </p>

                {/* Navigation Demo */}
                <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-medium mb-3">Navigation Bar</h3>
                    <nav className="flex gap-4">
                        <button id="nav-home" className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">
                            Home
                        </button>
                        <button id="nav-products" className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">
                            Products
                        </button>
                        <button id="nav-settings" className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">
                            Settings
                        </button>
                        <button id="nav-help" className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
                            Get Help
                        </button>
                    </nav>
                </div>

                {/* Feature Cards */}
                <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-medium mb-3">Feature Cards</h3>
                    <div className="grid grid-cols-3 gap-4">
                        <div id="feature-analytics" className="border rounded p-4 hover:shadow-md transition-shadow">
                            <h4 className="font-medium">Analytics</h4>
                            <p className="text-sm text-gray-600">Track user behavior</p>
                        </div>
                        <div id="feature-experiments" className="border rounded p-4 hover:shadow-md transition-shadow">
                            <h4 className="font-medium">Experiments</h4>
                            <p className="text-sm text-gray-600">A/B test features</p>
                        </div>
                        <div id="feature-surveys" className="border rounded p-4 hover:shadow-md transition-shadow">
                            <h4 className="font-medium">Surveys</h4>
                            <p className="text-sm text-gray-600">Collect feedback</p>
                        </div>
                    </div>
                </div>

                {/* Form Demo */}
                <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-medium mb-3">Sample Form</h3>
                    <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                        <div>
                            <label htmlFor="input-name" className="block text-sm font-medium mb-1">
                                Name
                            </label>
                            <input
                                id="input-name"
                                type="text"
                                className="border rounded px-3 py-2 w-full"
                                placeholder="Enter your name"
                            />
                        </div>
                        <div>
                            <label htmlFor="input-email" className="block text-sm font-medium mb-1">
                                Email
                            </label>
                            <input
                                id="input-email"
                                type="email"
                                className="border rounded px-3 py-2 w-full"
                                placeholder="Enter your email"
                            />
                        </div>
                        <button
                            id="submit-button"
                            type="submit"
                            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                        >
                            Submit
                        </button>
                    </form>
                </div>

                {/* Action Buttons */}
                <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-medium mb-3">Action Buttons</h3>
                    <div className="flex gap-4 flex-wrap">
                        <button id="btn-create" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                            Create New
                        </button>
                        <button
                            id="btn-import"
                            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
                        >
                            Import Data
                        </button>
                        <button
                            id="btn-export"
                            className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700"
                        >
                            Export
                        </button>
                        <button id="btn-share" className="bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700">
                            Share
                        </button>
                    </div>
                </div>

                {/* Sidebar Demo */}
                <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-medium mb-3">Sidebar Menu</h3>
                    <div className="flex gap-4">
                        <aside className="w-48 bg-gray-50 rounded p-3">
                            <ul className="space-y-2">
                                <li>
                                    <a
                                        id="sidebar-dashboard"
                                        href="#"
                                        className="block px-3 py-2 rounded hover:bg-gray-200"
                                    >
                                        Dashboard
                                    </a>
                                </li>
                                <li>
                                    <a
                                        id="sidebar-reports"
                                        href="#"
                                        className="block px-3 py-2 rounded hover:bg-gray-200"
                                    >
                                        Reports
                                    </a>
                                </li>
                                <li>
                                    <a
                                        id="sidebar-users"
                                        href="#"
                                        className="block px-3 py-2 rounded hover:bg-gray-200"
                                    >
                                        Users
                                    </a>
                                </li>
                                <li>
                                    <a
                                        id="sidebar-billing"
                                        href="#"
                                        className="block px-3 py-2 rounded hover:bg-gray-200"
                                    >
                                        Billing
                                    </a>
                                </li>
                            </ul>
                        </aside>
                        <div className="flex-1 bg-gray-50 rounded p-4">
                            <p className="text-gray-500">Main content area</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Instructions */}
            <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h3 className="font-medium mb-2">How to test product tours:</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                    <li>Open the PostHog toolbar (click the PostHog logo in the corner)</li>
                    <li>Click the "Product Tours" button (spotlight icon)</li>
                    <li>Create a new tour and select elements on this page</li>
                    <li>Save the tour</li>
                    <li>Use the dropdown above to select and launch your tour</li>
                </ol>
            </div>
        </div>
    )
}
