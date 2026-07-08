/** Google Gemini streaming chat, tracked by PostHog via OpenTelemetry. */

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

    const stream = await client.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: 'Explain observability in three sentences.',
    })

    for await (const chunk of stream) {
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
            process.stdout.write(text)
        }
    }

    console.log()
}

main().finally(() => sdk.shutdown())
