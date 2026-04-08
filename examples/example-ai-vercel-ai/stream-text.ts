/** Vercel AI streamText, tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

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
sdk.start()

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })

async function main() {
    const result = streamText({
        model: openai('gpt-4o-mini'),
        experimental_telemetry: {
            isEnabled: true,
            functionId: 'stream-text',
            metadata: {
                posthog_distinct_id: 'example-user',
            },
        },
        prompt: 'Explain observability in three sentences.',
    })

    for await (const chunk of result.textStream) {
        process.stdout.write(chunk)
    }

    console.log()
}

main()
