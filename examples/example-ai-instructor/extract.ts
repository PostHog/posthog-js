/** Instructor structured extraction with PostHog tracking. */

import Instructor from '@instructor-ai/instructor'
import { OpenAI } from '@posthog/ai/openai'
import { PostHog } from 'posthog-node'
import { z } from 'zod'

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
})
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
    posthog: phClient,
})
const client = Instructor({ client: openai, mode: 'TOOLS' })

const UserInfo = z.object({
    name: z.string(),
    age: z.number(),
})

async function main() {
    const user = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        response_model: { schema: UserInfo, name: 'UserInfo' },
        messages: [{ role: 'user', content: 'John Doe is 30 years old.' }],
        posthogDistinctId: 'example-user',
    })

    console.log(`${user.name} is ${user.age} years old`)
    await phClient.shutdown()
}

main()
