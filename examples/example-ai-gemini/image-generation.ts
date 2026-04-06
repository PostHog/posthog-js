/** Google Gemini image generation, tracked by PostHog. */

import { PostHog } from 'posthog-node'
import { Gemini as GoogleGenAI } from '@posthog/ai/gemini'

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
})
const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    posthog: phClient,
})

async function main() {
    const response = await client.models.generateContent({
        model: 'gemini-2.5-flash-image',
        posthogDistinctId: 'example-user',
        contents: 'Generate a pixel art hedgehog',
    })

    if (response.candidates) {
        for (const candidate of response.candidates) {
            for (const part of candidate.content?.parts || []) {
                if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith('image/')) {
                    console.log(
                        `Generated image: ${part.inlineData.mimeType}, ${part.inlineData.data.length} chars of base64 data`
                    )
                } else if (part.text) {
                    console.log(part.text)
                }
            }
        }
    }

    await phClient.shutdown()
}

main()
