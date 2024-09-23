import { cookies } from 'next/headers'
import PostHogClient from '@/app/lib/posthog'

export default function ServerEventPage() {
    async function trackServerEvent() {
        'use server'
        const cookieStore = cookies()
        const distinctId = cookieStore.get('ph_distinct_id')?.value

        const posthog = PostHogClient()
        posthog.capture({
            distinctId: distinctId || 'unknown',
            event: 'server_side_event',
            properties: {
                eventType: 'server-side',
            },
        })

        // Make sure to close the connection
        await posthog.flush()
    }

    return (
        <div className="flex flex-col justify-center items-center min-h-screen">
            <h1 className="mb-4 font-bold text-2xl">Server-side Event Tracking</h1>
            <form action={trackServerEvent}>
                <button
                    type="submit"
                    className="bg-green-500 hover:bg-green-700 px-4 py-2 rounded font-bold text-white"
                >
                    Track Server-side Event
                </button>
            </form>
        </div>
    )
}