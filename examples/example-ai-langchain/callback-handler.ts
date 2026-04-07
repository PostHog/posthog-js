/** LangChain chat, tracked by PostHog via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { LangChainInstrumentation } from '@traceloop/instrumentation-langchain'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-langchain-app',
        'user.id': 'example-user',
    }),
    traceExporter: new PostHogTraceExporter({
        apiKey: process.env.POSTHOG_API_KEY!,
        host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    }),
    instrumentations: [new LangChainInstrumentation()],
})
sdk.start()

const model = new ChatOpenAI({
    modelName: 'gpt-4o-mini',
    temperature: 0.7,
    openAIApiKey: process.env.OPENAI_API_KEY!,
})

async function main() {
    const response = await model.invoke([new HumanMessage('Explain observability in three sentences.')])

    console.log(response.content)
    await sdk.shutdown()
}

main()
