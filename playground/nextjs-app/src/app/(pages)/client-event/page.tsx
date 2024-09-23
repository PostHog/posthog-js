'use client'
import { usePostHog } from 'posthog-js/react'

export default function ClientEventPage() {
    const posthog = usePostHog()

    function handleClick() {
        posthog.capture('button_clicked', { buttonType: 'client-side' })
    }

    return (
        <div className="flex flex-col justify-center items-center min-h-screen">
            <h1 className="mb-4 font-bold text-2xl">Client-side Event Tracking</h1>
            <button
                onClick={handleClick}
                className="bg-blue-500 hover:bg-blue-700 px-4 py-2 rounded font-bold text-white"
            >
                Track Client-side Event
            </button>
        </div>
    )
}