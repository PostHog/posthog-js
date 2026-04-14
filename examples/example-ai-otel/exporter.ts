/** PostHog OTEL span processor for any OpenTelemetry-instrumented AI SDK. */

import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'

const sdk = new NodeSDK({
    spanProcessors: [
        new PostHogSpanProcessor({
            apiKey: process.env.POSTHOG_API_KEY!,
            host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
        }),
    ],
})

sdk.start()
console.log('OTEL SDK started with PostHog trace exporter.')
console.log('Any gen_ai.* spans will be converted to $ai_generation events in PostHog.')
console.log('Add your OTEL-instrumented AI SDK code here.')

// Graceful shutdown on exit.
process.on('SIGTERM', async () => {
    await sdk.shutdown()
    console.log('OTEL SDK shut down.')
    process.exit(0)
})

// Keep the process running so the SDK can export spans.
// In a real application, your server or agent loop keeps the process alive.
setTimeout(() => {
    console.log('No spans generated in this demo. Shutting down.')
    sdk.shutdown().then(() => process.exit(0))
}, 5000)
