import { postHogMiddleware } from '@posthog/next/middleware'

export default postHogMiddleware({ proxy: true })

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
