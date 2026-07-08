/** AWS Bedrock chat with OpenTelemetry instrumentation, tracked by PostHog. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-bedrock-app',
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
    instrumentations: [new AwsInstrumentation()],
})
sdk.start()

async function main() {
    // Import after sdk.start() so the instrumentation can patch the AWS SDK.
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')

    const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1',
    })

    const response = await client.send(
        new ConverseCommand({
            modelId: 'openai.gpt-oss-20b-1:0',
            messages: [
                {
                    role: 'user',
                    content: [{ text: 'Tell me a fun fact about hedgehogs.' }],
                },
            ],
        })
    )

    const textBlock = response.output?.message?.content?.find((b: any) => 'text' in b)
    console.log(textBlock?.text)
}

main().finally(() => sdk.shutdown())
