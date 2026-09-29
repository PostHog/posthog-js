import { PostHog } from 'posthog-node/edge'

export const runtime = 'edge'

export async function GET(request: Request): Promise<Response> {
    const posthog = new PostHog(process.env.POSTHOG_PROJECT_API_KEY!, {
        host: process.env.POSTHOG_HOST,
        flushInterval: 0,
    })

    posthog.capture({
        distinctId: 'example-user',
        event: 'nextjs_edge_route_request',
        properties: { pathname: new URL(request.url).pathname },
    })
    await posthog.flush().catch((error) => console.error('PostHog flush failed', error))

    return new Response('Hello from a Next.js Edge Route Handler!')
}
