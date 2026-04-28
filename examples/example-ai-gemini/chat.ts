/** Google Gemini chat with tool calling, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { GenAIInstrumentation } from '@traceloop/instrumentation-google-generativeai'
import { GoogleGenAI, Type } from '@google/genai'
import type { FunctionDeclaration } from '@google/genai'

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

const weatherTool: FunctionDeclaration = {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: {
        type: Type.OBJECT,
        properties: {
            latitude: { type: Type.NUMBER },
            longitude: { type: Type.NUMBER },
            location_name: { type: Type.STRING },
        },
        required: ['latitude', 'longitude', 'location_name'],
    },
}

async function getWeather(latitude: number, longitude: number, locationName: string): Promise<string> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`
    const resp = await fetch(url)
    const data = await resp.json()
    const current = data.current
    return `Weather in ${locationName}: ${current.temperature_2m}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h`
}

async function main() {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

    const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: "What's the weather like in Dublin, Ireland?",
        config: {
            tools: [{ functionDeclarations: [weatherTool] }],
        },
    })

    // In production, send tool results back to the model for a final response.
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) {
            console.log(part.text)
        } else if (part.functionCall) {
            const args = part.functionCall.args as { latitude: number; longitude: number; location_name: string }
            const result = await getWeather(args.latitude, args.longitude, args.location_name)
            console.log(result)
        }
    }
}

main().finally(() => sdk.shutdown())
