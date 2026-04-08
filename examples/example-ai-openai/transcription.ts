/** OpenAI audio transcription (Whisper), tracked by PostHog via OpenTelemetry. */

import { NodeSDK, tracing } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PostHogTraceExporter } from '@posthog/ai/otel'
import { OpenAIInstrumentation } from '@opentelemetry/instrumentation-openai'
import OpenAI from 'openai'
import * as fs from 'fs'

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        'service.name': 'example-openai-app',
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
    instrumentations: [new OpenAIInstrumentation()],
})
sdk.start()

async function main() {
    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
    })

    // Replace with the path to your audio file
    const audioPath = process.env.AUDIO_PATH || 'audio.mp3'

    if (!fs.existsSync(audioPath)) {
        console.log(`Skipping: audio file not found at '${audioPath}'`)
        console.log('Set AUDIO_PATH to a valid audio file (mp3, wav, m4a, etc.)')
        return
    }

    const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
    })

    console.log(`Transcription: ${transcription.text}`)
}

main()
