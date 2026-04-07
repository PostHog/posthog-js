/**
 * Convex-style OpenTelemetry integration with PostHog.
 *
 * This example shows how to use the PostHog OTEL trace exporter with the
 * Vercel AI SDK, which is the pattern used in Convex actions.
 * In a real Convex app, this code runs inside a "use node" action.
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { Resource } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const sdk = new NodeSDK({
    resource: new Resource({
        'service.name': 'example-convex-app',
        'user.id': 'example-user',
    }),
    traceExporter: new PostHogTraceExporter({
        apiKey: process.env.POSTHOG_API_KEY!,
        host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    }),
})
sdk.start()

async function main() {
    const result = await generateText({
        model: openai('gpt-4o-mini'),
        prompt: 'Tell me a fun fact about hedgehogs.',
        experimental_telemetry: {
            isEnabled: true,
            functionId: 'example-convex-action',
            metadata: {
                posthog_distinct_id: 'example-user',
            },
        },
    })

    console.log(result.text)
    await sdk.shutdown()
}

main()
