import { app } from 'electron'

// Do not await import: main waits for app readiness.
void import('../main.mjs').catch((error) => {
    console.error(error)
    app.exit(1)
})
