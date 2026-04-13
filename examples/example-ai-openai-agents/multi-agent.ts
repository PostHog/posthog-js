/** OpenAI Agents SDK multi-agent with handoffs, tracked by PostHog. */

import { PostHog } from 'posthog-node'
import { instrument } from '@posthog/ai/openai-agents'
import { Agent, run, tool } from '@openai/agents'
import { z } from 'zod'

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
})

instrument({ client: phClient, distinctId: 'example-user' })

const getWeather = tool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: z.object({
    city: z.string().describe('The city to get weather for'),
  }),
  execute: async ({ city }) => {
    return `Weather in ${city}: 18°C, partly cloudy, humidity 65%`
  },
})

const calculate = tool({
  name: 'calculate',
  description: 'Evaluate a mathematical expression',
  parameters: z.object({
    expression: z.string().describe('A math expression to evaluate'),
  }),
  execute: async ({ expression }) => {
    return `Result: ${eval(expression)}`
  },
})

const weatherAgent = new Agent({
  name: 'WeatherAgent',
  instructions: 'You handle weather queries. Use the get_weather tool.',
  model: 'gpt-4o-mini',
  tools: [getWeather],
})

const mathAgent = new Agent({
  name: 'MathAgent',
  instructions: 'You handle math problems. Use the calculate tool.',
  model: 'gpt-4o-mini',
  tools: [calculate],
})

const generalAgent = new Agent({
  name: 'GeneralAgent',
  instructions: 'You handle general questions and conversation.',
  model: 'gpt-4o-mini',
})

const triageAgent = new Agent({
  name: 'TriageAgent',
  instructions: 'Route to WeatherAgent for weather, MathAgent for math, GeneralAgent for everything else.',
  model: 'gpt-4o-mini',
  handoffs: [weatherAgent, mathAgent, generalAgent],
})

async function main() {
  const result = await run(triageAgent, "What's the weather in Tokyo?")
  console.log(result.finalOutput)
  await phClient.shutdown()
}

main()
