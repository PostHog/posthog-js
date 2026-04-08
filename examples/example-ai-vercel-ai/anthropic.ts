/** Vercel AI with Anthropic backend, tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-vercel-ai-app',
    }),
    spanProcessors: [
        new tracing.SimpleSpanProcessor(
            new PostHogTraceExporter({
                apiKey: process.env.POSTHOG_API_KEY!,
                host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
            })
        ),
    ],
})
sdk.start() // SimpleSpanProcessor exports each span synchronously — no shutdown needed

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

async function main() {
    const { text } = await generateText({
        model: anthropic('claude-sonnet-4-5-20250929'),
        experimental_telemetry: {
            isEnabled: true,
            functionId: 'anthropic-generate',
            metadata: {
                posthog_distinct_id: 'example-user',
            },
        },
        prompt: 'Explain observability in three sentences.',
    })

    console.log(text)
}

main()
