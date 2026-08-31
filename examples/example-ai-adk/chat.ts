/** Google Agent Development Kit agent tracked by PostHog. */

import { randomUUID } from 'node:crypto'
import { InMemorySessionService, LlmAgent, Runner } from '@google/adk'
import { PostHogADKPlugin } from '@posthog/ai/adk'
import { PostHog } from 'posthog-node'

const posthogApiKey = process.env.POSTHOG_API_KEY
const googleApiKey = process.env.GOOGLE_API_KEY

if (!posthogApiKey || !googleApiKey) {
    throw new Error('POSTHOG_API_KEY and GOOGLE_API_KEY must be set')
}

const posthog = new PostHog(posthogApiKey, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
})

const agent = new LlmAgent({
    name: 'posthog_adk_example',
    model: 'gemini-3.6-flash',
    instruction: 'Be concise and helpful.',
})

const sessionService = new InMemorySessionService()
const runner = new Runner({
    appName: 'example-ai-adk',
    agent,
    sessionService,
    plugins: [
        new PostHogADKPlugin({
            client: posthog,
            captureImmediate: true,
            properties: { example: 'example-ai-adk' },
            onError: (error) => console.error('Failed to capture PostHog AI event:', error),
        }),
    ],
})

async function main(): Promise<void> {
    const userId = 'example-ai-adk-user'
    const sessionId = randomUUID()
    const promptArgs = process.argv.slice(2)
    const prompt =
        (promptArgs[0] === '--' ? promptArgs.slice(1) : promptArgs).join(' ') ||
        'Explain in one sentence why observability matters for AI agents.'

    await sessionService.createSession({
        appName: runner.appName,
        userId,
        sessionId,
    })

    for await (const event of runner.runAsync({
        userId,
        sessionId,
        newMessage: { role: 'user', parts: [{ text: prompt }] },
    })) {
        for (const part of event.content?.parts ?? []) {
            if (part.text) {
                console.log(part.text)
            }
        }
    }
}

main()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(() => posthog.shutdown())
