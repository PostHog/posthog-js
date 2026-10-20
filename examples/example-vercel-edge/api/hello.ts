import { waitUntil } from '@vercel/functions'
import { PostHog } from 'posthog-node/edge'

export const config = { runtime: 'edge' }

export default function handler(request: Request): Response {
    const posthog = new PostHog(process.env.POSTHOG_PROJECT_API_KEY!, {
        host: process.env.POSTHOG_HOST,
        flushInterval: 0,
    })

    posthog.capture({
        distinctId: 'example-user',
        event: 'vercel_edge_request',
        properties: { pathname: new URL(request.url).pathname },
    })
    // Keep delivery alive after the response without making the caller wait for PostHog.
    waitUntil(posthog.flush().catch((error) => console.error('PostHog flush failed', error)))

    return new Response('Hello from a Vercel Edge Function!')
}
