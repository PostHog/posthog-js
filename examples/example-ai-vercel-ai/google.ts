/** Vercel AI with Google backend, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-vercel-ai-app',
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
})
sdk.start()

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! })

async function main() {
    const { text } = await generateText({
        model: google('gemini-2.5-flash'),
        experimental_telemetry: {
            isEnabled: true,
            functionId: 'google-generate',
            metadata: {
                posthog_distinct_id: 'example-user',
            },
        },
        prompt: 'Explain observability in three sentences.',
    })

    console.log(text)
}

main().finally(() => sdk.shutdown())
