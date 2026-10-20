import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { PostHog } from 'posthog-node/edge'

export function middleware(request: NextRequest, event: NextFetchEvent): NextResponse {
    const posthog = new PostHog(process.env.POSTHOG_PROJECT_API_KEY!, {
        host: process.env.POSTHOG_HOST,
        flushInterval: 0,
    })

    posthog.capture({
        distinctId: 'example-user',
        event: 'nextjs_edge_middleware_request',
        properties: { pathname: request.nextUrl.pathname },
    })
    event.waitUntil(posthog.flush().catch((error) => console.error('PostHog flush failed', error)))

    return NextResponse.next()
}

// Next.js 15 middleware uses Edge by default; proxy.ts in Next.js 16 uses Node.js.
export const config = { matcher: '/' }
