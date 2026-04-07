/** Portkey AI gateway chat completions, tracked by PostHog. */

import { PostHog } from 'posthog-node'
import { OpenAI } from '@posthog/ai/openai'
import { PORTKEY_GATEWAY_URL } from 'portkey-ai'

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
})
const client = new OpenAI({
    baseURL: PORTKEY_GATEWAY_URL,
    apiKey: process.env.PORTKEY_API_KEY!,
    posthog: phClient,
})

async function main() {
    const response = await client.chat.completions.create({
        model: '@openai/gpt-5-mini',
        max_completion_tokens: 1024,
        posthogDistinctId: 'example-user',
        messages: [{ role: 'user', content: 'Tell me a fun fact about hedgehogs.' }],
    })

    console.log(response.choices[0].message.content)
    await phClient.shutdown()
}

main()
