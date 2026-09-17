import { Binding } from './binding.mjs'

// A process per case isolates SDK timers, environment selection, and late traffic.
// Only the public lifecycle is used; a failed deadline kills the process.
export function start(PostHog) {
    const binding = new Binding(PostHog, process.env.POSTHOG_CAPTURE_MODE)
    process.on('message', async ({ route, args, close }) => {
        try {
            if (close) {
                await binding.client?.shutdown()
                process.send({ closed: true })
            } else {
                process.send({ completion: await binding.invoke(route, args) })
            }
        } catch {
            process.send({ error: 'Public SDK shutdown failed' })
        }
    })
    process.send({ ready: true })
}
