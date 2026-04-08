/** OpenAI Responses API with streaming, tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai'
import OpenAI from 'openai'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-openai-app',
        'posthog.distinct_id': 'example-user',
        foo: 'bar',
        'conversation_id': 'abc-123',
    }),
    spanProcessors: [
        new tracing.SimpleSpanProcessor(
            new PostHogTraceExporter({
                apiKey: process.env.POSTHOG_API_KEY!,
                host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
            })
        ),
    ],
    instrumentations: [new OpenAIInstrumentation()],
})
sdk.start() // SimpleSpanProcessor exports each span synchronously — no shutdown needed

async function main() {
    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
    })

    const stream = await client.responses.create({
        model: 'gpt-4o-mini',
        max_output_tokens: 1024,
        stream: true,
        instructions: 'You are a helpful assistant.',
        input: [
            {
                role: 'user',
                content: 'Write a haiku about product analytics.',
            },
        ],
    })

    for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
            process.stdout.write(event.delta)
        }
    }

    console.log()
}

main()
