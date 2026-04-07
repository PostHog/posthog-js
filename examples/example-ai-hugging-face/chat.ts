/** Hugging Face chat completions via OpenAI-compatible API, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-hugging-face-app',
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
        baseURL: 'https://router.huggingface.co/v1/',
        apiKey: process.env.HUGGINGFACE_API_KEY!,
    })

    const response = await client.chat.completions.create({
        model: 'meta-llama/Llama-3.3-70B-Instruct',
        max_completion_tokens: 1024,
        messages: [{ role: 'user', content: 'Tell me a fun fact about hedgehogs.' }],
    })

    console.log(response.choices[0].message.content)
    await sdk.shutdown()
}

main()
