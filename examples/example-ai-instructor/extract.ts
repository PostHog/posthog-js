/** Instructor structured extraction with PostHog tracking via OpenTelemetry. */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai'
import OpenAI from 'openai'
import Instructor from '@instructor-ai/instructor'
import { z } from 'zod'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-instructor-app',
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
    instrumentations: [new OpenAIInstrumentation()],
})
sdk.start()

const UserInfo = z.object({
    name: z.string(),
    age: z.number(),
})

async function main() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
    })
    const client = Instructor({ client: openai, mode: 'TOOLS' })

    const user = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        response_model: { schema: UserInfo, name: 'UserInfo' },
        messages: [{ role: 'user', content: 'John Doe is 30 years old.' }],
    })

    console.log(`${user.name} is ${user.age} years old`)
}

main().finally(() => sdk.shutdown())
