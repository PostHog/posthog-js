/** Vercel AI streamObject for streaming structured output, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { streamObject } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

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

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const WeatherSchema = z.object({
    location: z.string(),
    temperature: z.number().describe('Temperature in Celsius'),
    humidity: z.number().describe('Relative humidity percentage'),
    conditions: z.string().describe('Brief weather description'),
    windSpeed: z.number().describe('Wind speed in km/h'),
})

async function main() {
    const result = streamObject({
        model: openai('gpt-4o-mini'),
        experimental_telemetry: {
            isEnabled: true,
            functionId: 'stream-object',
            metadata: {
                posthog_distinct_id: 'example-user',
            },
        },
        schema: WeatherSchema,
        prompt: 'Describe typical weather in Dublin, Ireland in March.',
    })

    for await (const partial of result.partialObjectStream) {
        console.clear()
        console.log('Streaming object:', JSON.stringify(partial, null, 2))
    }

    const final = await result.object
    console.log('\nFinal:', JSON.stringify(final, null, 2))
}

main().finally(() => sdk.shutdown())
