/** Vercel AI generateObject for structured output, tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { generateObject } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-vercel-ai-app',
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
})
sdk.start() // SimpleSpanProcessor exports each span synchronously — no shutdown needed

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const WeatherSchema = z.object({
    location: z.string(),
    temperature: z.number().describe('Temperature in Celsius'),
    humidity: z.number().describe('Relative humidity percentage'),
    conditions: z.string().describe('Brief weather description'),
    windSpeed: z.number().describe('Wind speed in km/h'),
})

async function main() {
    const { object } = await generateObject({
        model: openai('gpt-4o-mini'),
        experimental_telemetry: {
            isEnabled: true,
            functionId: 'generate-object',
            metadata: {
                posthog_distinct_id: 'example-user',
            },
        },
        schema: WeatherSchema,
        prompt: 'Describe typical weather in Dublin, Ireland in March.',
    })

    console.log('Location:', object.location)
    console.log('Temperature:', object.temperature, '°C')
    console.log('Humidity:', object.humidity, '%')
    console.log('Conditions:', object.conditions)
    console.log('Wind:', object.windSpeed, 'km/h')
}

main()
