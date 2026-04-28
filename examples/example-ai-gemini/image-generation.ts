/** Google Gemini image generation, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { GenAIInstrumentation } from '@traceloop/instrumentation-google-generativeai'
import { GoogleGenAI } from '@google/genai'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-gemini-app',
        'posthog.distinct_id': 'example-user',
        foo: 'bar',
        conversation_id: 'abc-123',
    }),
    spanProcessors: [
        new PostHogSpanProcessor({
            apiKey: process.env.POSTHOG_API_KEY!,
            host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
        }),
    ],
    instrumentations: [new GenAIInstrumentation()],
})
sdk.start()

async function main() {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

    const response = await client.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: 'Generate a pixel art hedgehog',
    })

    if (response.candidates) {
        for (const candidate of response.candidates) {
            for (const part of candidate.content?.parts || []) {
                if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith('image/')) {
                    console.log(
                        `Generated image: ${part.inlineData.mimeType}, ${part.inlineData.data.length} chars of base64 data`
                    )
                } else if (part.text) {
                    console.log(part.text)
                }
            }
        }
    }
}

main().finally(() => sdk.shutdown())
