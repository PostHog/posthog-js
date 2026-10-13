import { PostHog } from 'posthog-node/edge'

interface Env {
    POSTHOG_PROJECT_API_KEY: string
    POSTHOG_API_HOST: string
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Response {
        const posthog = new PostHog(env.POSTHOG_PROJECT_API_KEY, {
            host: env.POSTHOG_API_HOST,
            flushInterval: 0,
        })

        posthog.capture({
            distinctId: 'example-user',
            event: 'cloudflare_edge_request',
            properties: { pathname: new URL(request.url).pathname },
        })
        ctx.waitUntil(posthog.flush().catch((error) => console.error('PostHog flush failed', error)))

        return new Response('Hello from Cloudflare Workers!')
    },
} satisfies ExportedHandler<Env>
