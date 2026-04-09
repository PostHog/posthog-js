/** Mastra agent with manual PostHog instrumentation. */

import { PostHog } from 'posthog-node'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { randomUUID } from 'crypto'

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
})

const weatherTool = createTool({
    id: 'get_weather',
    description: 'Get current weather for a location',
    inputSchema: z.object({
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
})

const agent = new Agent({
    name: 'Weather Agent',
    instructions: 'You are a helpful assistant with access to weather data.',
    model: { id: 'openai/gpt-5-mini' },
    tools: { get_weather: weatherTool },
})

async function main() {
    const traceId = randomUUID()
    const startTime = Date.now()

    const result = await agent.generate("What's the weather like in Dublin, Ireland?")

    const endTime = Date.now()
    const latency = (endTime - startTime) / 1000

    // Manual PostHog instrumentation for frameworks without native support.
    phClient.capture({
        distinctId: 'example-user',
        event: '$ai_generation',
        properties: {
            $ai_trace_id: traceId,
            $ai_model: 'gpt-5-mini',
            $ai_provider: 'openai',
            $ai_input_tokens: result.usage?.promptTokens,
            $ai_output_tokens: result.usage?.completionTokens,
            $ai_latency: latency,
            $ai_input: "What's the weather like in Dublin, Ireland?",
            $ai_output: result.text,
        },
    })

    console.log(result.text)
    await phClient.shutdown()
}

main()
