/** OpenAI Chat Completions API with tool calling, tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai'
import OpenAI from 'openai'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-openai-app',
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
    instrumentations: [new OpenAIInstrumentation()],
})
sdk.start() // SimpleSpanProcessor exports each span synchronously — no shutdown needed

async function getWeather(latitude: number, longitude: number, locationName: string): Promise<string> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`
    const resp = await fetch(url)
    const data = await resp.json()
    const current = data.current
    return `Weather in ${locationName}: ${current.temperature_2m}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h`
}

async function main() {
    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
    })

    const tools = [
        {
            type: 'function' as const,
            function: {
                name: 'get_weather',
                description: 'Get current weather for a location',
                parameters: {
                    type: 'object',
                    properties: {
                        latitude: { type: 'number' },
                        longitude: { type: 'number' },
                        location_name: { type: 'string' },
                    },
                    required: ['latitude', 'longitude', 'location_name'],
                },
            },
        },
    ]

    const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_completion_tokens: 1024,
        tools,
        tool_choice: 'auto',
        messages: [
            {
                role: 'system',
                content: 'You are a helpful assistant with access to weather data.',
            },
            { role: 'user', content: "What's the weather like in Dublin, Ireland?" },
        ],
    })

    const message = response.choices[0].message

    if (message.content) {
        console.log(message.content)
    }

    // In production, send tool results back to the model for a final response.
    if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments)
            const result = await getWeather(args.latitude, args.longitude, args.location_name)
            console.log(result)
        }
    }
}

main()
