/** LangGraph agent, tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { LangChainInstrumentation } from '@traceloop/instrumentation-langchain'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-langgraph-app',
        'user.id': 'example-user',
    }),
    spanProcessors: [
        new tracing.SimpleSpanProcessor(
            new PostHogTraceExporter({
                apiKey: process.env.POSTHOG_API_KEY!,
                host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
            })
        ),
    ],
    instrumentations: [new LangChainInstrumentation()],
})
sdk.start() // SimpleSpanProcessor exports each span synchronously — no shutdown needed

const getWeather = tool((input) => `It's always sunny in ${input.city}!`, {
    name: 'get_weather',
    description: 'Get the weather for a given city',
    schema: z.object({
        city: z.string().describe('The city to get the weather for'),
    }),
})

const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
})

async function main() {
    const agent = createReactAgent({ llm: model, tools: [getWeather] })

    const result = await agent.invoke({
        messages: [{ role: 'user', content: "What's the weather in Paris?" }],
    })

    console.log(result.messages[result.messages.length - 1].content)
}

main()
