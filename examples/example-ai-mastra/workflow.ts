/** Mastra agent with PostHog tracking via the official @mastra/posthog exporter. */

import { Mastra } from '@mastra/core'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { Observability } from '@mastra/observability'
import { PosthogExporter } from '@mastra/posthog'
import { z } from 'zod'

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

const weatherAgent = new Agent({
    id: 'weather-agent',
    name: 'Weather Agent',
    instructions: 'You are a helpful assistant with access to weather data.',
    model: { id: 'openai/gpt-5-mini' },
    tools: { get_weather: weatherTool },
})

const mastra = new Mastra({
    agents: { weatherAgent },
    observability: new Observability({
        configs: {
            posthog: {
                serviceName: 'example-mastra-app',
                exporters: [
                    new PosthogExporter({
                        apiKey: process.env.POSTHOG_API_KEY!,
                        host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
                        defaultDistinctId: 'example-user',
                    }),
                ],
            },
        },
    }),
})

async function main() {
    const agent = mastra.getAgent('weatherAgent')
    const result = await agent.generate("What's the weather like in Dublin, Ireland?", {
        tracingOptions: {
            metadata: {
                userId: 'example-user',
                sessionId: 'session-abc-123',
                foo: 'bar',
                conversation_id: 'abc-123',
            },
        },
    })
    console.log(result.text)
}

main()
