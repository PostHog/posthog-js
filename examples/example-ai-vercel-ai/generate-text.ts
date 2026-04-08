/** Vercel AI generateText with tool calling, tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { generateText, tool } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-vercel-ai-app',
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
sdk.start()

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! })

async function main() {
    const { text, toolResults } = await generateText({
        model: openai('gpt-4o-mini'),
        experimental_telemetry: {
            isEnabled: true,
            functionId: 'generate-text',
            metadata: {
                posthog_distinct_id: 'example-user',
            },
        },
        tools: {
            get_weather: tool({
                description: 'Get current weather for a location',
                parameters: z.object({
                    latitude: z.number(),
                    longitude: z.number(),
                    location_name: z.string(),
                }),
                execute: async ({ latitude, longitude, location_name }) => {
                    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`
                    const resp = await fetch(url)
                    const data = await resp.json()
                    const current = data.current
                    return `Weather in ${location_name}: ${current.temperature_2m}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h`
                },
            }),
        },
        prompt: "What's the weather like in Dublin, Ireland?",
    })

    console.log('Response:', text)
    for (const result of toolResults ?? []) {
        console.log('Tool result:', result.result)
    }
}

main()
