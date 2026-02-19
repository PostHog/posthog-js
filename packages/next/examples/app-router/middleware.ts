import { postHogMiddleware } from '@posthog/next/middleware'

export default postHogMiddleware({
    apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY!,
})

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
