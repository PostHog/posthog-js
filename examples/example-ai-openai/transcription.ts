/** OpenAI audio transcription (Whisper), tracked by PostHog. */

import { PostHog } from 'posthog-node'
import { OpenAI } from '@posthog/ai/openai'
import * as fs from 'fs'

const phClient = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
})
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
    posthog: phClient,
})

async function main() {
    // Replace with the path to your audio file
    const audioPath = process.env.AUDIO_PATH || 'audio.mp3'

    if (!fs.existsSync(audioPath)) {
        console.log(`Skipping: audio file not found at '${audioPath}'`)
        console.log('Set AUDIO_PATH to a valid audio file (mp3, wav, m4a, etc.)')
        await phClient.shutdown()
        return
    }

    const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        posthogDistinctId: 'example-user',
    })

    console.log(`Transcription: ${transcription.text}`)

    await phClient.shutdown()
}

main()
