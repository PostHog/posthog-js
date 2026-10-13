import { createRequire, register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PostHog } from './index.node'

/**
 * `node --import posthog-node/metrics/register app.js`
 *
 * Starts metrics autocapture before the app loads any module, so every library
 * the app imports is instrumented. Configured from the environment:
 * `POSTHOG_PROJECT_TOKEN` (or `POSTHOG_API_KEY`), `POSTHOG_HOST` and
 * `OTEL_SERVICE_NAME`.
 */

// Short enough to fit inside a container's termination grace period.
const SHUTDOWN_TIMEOUT_MS = 5000
const EXIT_SIGNALS = ['SIGTERM', 'SIGINT'] as const

// ESM imports bypass the CommonJS require hook, so ESM apps need the loader hook
// the OpenTelemetry instrumentations ship. Without it, only `require` is patched.
function registerEsmLoaderHook(): void {
  try {
    const autoInstrumentations = createRequire(import.meta.url).resolve('@opentelemetry/auto-instrumentations-node')
    const hook = createRequire(autoInstrumentations).resolve('@opentelemetry/instrumentation/hook.mjs')
    register(pathToFileURL(hook))
  } catch {
    // Missing packages are reported once by the client below.
  }
}

const token = process.env.POSTHOG_PROJECT_TOKEN || process.env.POSTHOG_API_KEY

if (token) {
  registerEsmLoaderHook()
  const posthog = new PostHog(token, {
    host: process.env.POSTHOG_HOST,
    metrics: { autocapture: true, serviceName: process.env.OTEL_SERVICE_NAME },
  })
  let shuttingDown: Promise<void> | undefined
  const shutdown = (): Promise<void> => (shuttingDown ??= posthog.shutdown(SHUTDOWN_TIMEOUT_MS).catch(() => {}))

  // Sends the last window when the event loop drains.
  process.once('beforeExit', () => {
    void shutdown()
  })
  // `beforeExit` does not run on a signal, so the last window is sent here too.
  // `once` removes this listener before it runs: when no other listener is left,
  // the app has no handler of its own, and the signal is raised again after the
  // flush so the process still exits the default way. When the app has a
  // handler, it owns the exit.
  for (const signal of EXIT_SIGNALS) {
    process.once(signal, () => {
      const appHandlesSignal = process.listenerCount(signal) > 0
      void shutdown().then(() => {
        if (!appHandlesSignal) {
          process.kill(process.pid, signal)
        }
      })
    })
  }
} else {
  console.warn('[PostHog] posthog-node/metrics/register needs POSTHOG_PROJECT_TOKEN, so metrics autocapture is off.')
}
