/** Helicone chat completions via OpenAI-compatible API, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-helicone-app',
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
    // Import after sdk.start() so the instrumentation can patch the OpenAI SDK.
    const { default: OpenAI } = await import('openai')

    const client = new OpenAI({
        baseURL: 'https://ai-gateway.helicone.ai/',
        apiKey: process.env.HELICONE_API_KEY!,
    })

    const response = await client.chat.completions.create({
        model: 'gpt-5-mini',
        max_completion_tokens: 1024,
        messages: [{ role: 'user', content: 'Tell me a fun fact about hedgehogs.' }],
    })

    console.log(response.choices[0].message.content)
    await sdk.shutdown()
}

main()
