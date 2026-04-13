/** OpenAI Agents SDK single agent with tools, tracked by PostHog. */

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
    return `Weather in ${city}: 22°C, clear skies, humidity 45%`
  },
})

const calculate = tool({
  name: 'calculate',
  description: 'Evaluate a mathematical expression',
  parameters: z.object({
    expression: z.string().describe('A math expression to evaluate'),
  }),
  execute: async ({ expression }) => {
    // Stub: replace with a real math library (e.g. mathjs) in production
    return `Result of "${expression}": (math evaluation not implemented in this example)`
  },
})

const agent = new Agent({
  name: 'Assistant',
  instructions: 'You are a helpful assistant with weather and math tools.',
  model: 'gpt-4o-mini',
  tools: [getWeather, calculate],
})

async function main() {
  const result = await run(agent, "What's 15% of 280?")
  console.log(result.finalOutput)
  await phClient.shutdown()
}

main()
