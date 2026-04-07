/** OpenAI image generation, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai'
import OpenAI from 'openai'

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
    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
    })

    const response = await client.images.generate({
        model: 'gpt-image-1',
        prompt: 'A hedgehog wearing a PostHog t-shirt, pixel art style',
        size: '1024x1024',
    })

    const imageBase64 = response.data[0].b64_json!
    console.log(`Generated image: ${imageBase64.length} chars of base64 data`)

    await sdk.shutdown()
}

main()
