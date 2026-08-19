import { createOpenAI } from '@ai-sdk/openai'
import { OpenTelemetry } from '@ai-sdk/otel'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { generateText, registerTelemetry } from 'ai'

import { getPostHogSpanAttributes } from './telemetry.js'

const projectToken = process.env.POSTHOG_PROJECT_TOKEN
if (!projectToken) {
    throw new Error('POSTHOG_PROJECT_TOKEN is required')
}

const modelId = process.env.OPENAI_MODEL
if (!modelId) {
    throw new Error('OPENAI_MODEL is required')
}

const posthogSpanProcessor = new PostHogSpanProcessor({
    projectToken,
    host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
})

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-vercel-ai-v7',
    }),
    spanProcessors: [posthogSpanProcessor],
})

// Initialize both integrations before the first AI SDK call.
sdk.start()
registerTelemetry(
    new OpenTelemetry({
        enrichSpan: getPostHogSpanAttributes,
    })
)

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
const captureContent = process.env.POSTHOG_CAPTURE_AI_CONTENT === 'true'

try {
    const result = await generateText({
        model: openai(modelId),
        prompt: 'Explain why hedgehogs are excellent observability mascots in one sentence.',
        runtimeContext: {
            distinctId: 'example-user',
            sessionId: 'example-session',
            traceName: 'hedgehog-fact',
            groups: {
                company: 'example-company',
            },
            properties: {
                environment: 'development',
                feature: 'vercel-ai-v7-example',
            },
        },
        telemetry: {
            functionId: 'hedgehog-fact',
            includeRuntimeContext: {
                distinctId: true,
                sessionId: true,
                traceName: true,
                groups: true,
                properties: true,
            },
            // Inputs and outputs can contain sensitive content. This example records
            // them only when explicitly enabled.
            recordInputs: captureContent,
            recordOutputs: captureContent,
        },
    })

    console.log(result.text)
} finally {
    // Request-scoped runtimes must await pending exports before their lifecycle ends.
    await posthogSpanProcessor.forceFlush()
    await sdk.shutdown()
}
