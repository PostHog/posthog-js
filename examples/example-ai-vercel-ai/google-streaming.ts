/** Vercel AI with Google Gemini backend (streaming), tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { streamText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
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

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! })

async function getWeather(latitude: number, longitude: number, locationName: string): Promise<string> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`
    const resp = await fetch(url)
    const data = await resp.json()
    const current = data.current
    return `Weather in ${locationName}: ${current.temperature_2m}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h`
}

async function main() {
    const result = streamText({
        model: google('gemini-2.5-flash'),
        experimental_telemetry: {
            isEnabled: true,
            functionId: 'google-streaming',
            metadata: {
                posthog_distinct_id: 'example-user',
            },
        },
        maxTokens: 1024,
        messages: [
            { role: 'system', content: 'You are a helpful assistant with access to weather data.' },
            { role: 'user', content: "What's the weather in Berlin?" },
        ],
        tools: {
            get_weather: {
                description: 'Get current weather for a location',
                parameters: z.object({
                    latitude: z.number(),
                    longitude: z.number(),
                    location_name: z.string(),
                }),
                execute: async ({ latitude, longitude, location_name }) => {
                    return getWeather(latitude, longitude, location_name)
                },
            },
        },
    })

    for await (const chunk of result.textStream) {
        process.stdout.write(chunk)
    }

    console.log()
}

main()
