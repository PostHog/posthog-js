/** Anthropic streaming chat, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { AnthropicInstrumentation } from '@traceloop/instrumentation-anthropic'
import Anthropic from '@anthropic-ai/sdk'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-anthropic-app',
        'user.id': 'example-user',
    }),
    traceExporter: new PostHogTraceExporter({
        apiKey: process.env.POSTHOG_API_KEY!,
        host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    }),
    instrumentations: [new AnthropicInstrumentation()],
})
sdk.start()

async function main() {
    const client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
    })

    const stream = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: 'Explain observability in three sentences.' }],
    })

    for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            process.stdout.write(event.delta.text)
        }
    }

    console.log()
    await sdk.shutdown()
}

main()
