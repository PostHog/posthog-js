import { app } from 'electron'

// Await so privileged schemes register before ready; main.mjs waits for readiness inside a non-awaited main().
try {
    await import('../main.mjs')
} catch (error) {
    console.error(error)
    app.exit(1)
}
