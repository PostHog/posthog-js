/** OpenAI Chat Completions API with streaming, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-openai-app',
        'user.id': 'example-user',
    }),
    traceExporter: new PostHogTraceExporter({
        apiKey: process.env.POSTHOG_API_KEY!,
        host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    }),
    instrumentations: [new OpenAIInstrumentation()],
})
sdk.start()

async function main() {
    const { default: OpenAI } = await import('openai')

    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
    })

    const stream = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_completion_tokens: 1024,
        stream: true,
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Explain observability in three sentences.' },
        ],
    })

    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
            process.stdout.write(content)
        }
    }

    console.log()
    await sdk.shutdown()
}

main()
