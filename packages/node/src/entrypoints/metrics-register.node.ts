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
  // Sends the last window when the event loop drains. Signals are left to the
  // app: a handler here would stop the default exit on SIGTERM.
  process.once('beforeExit', () => {
    void posthog.shutdown()
  })
} else {
  console.warn('[PostHog] posthog-node/metrics/register needs POSTHOG_PROJECT_TOKEN, so metrics autocapture is off.')
}
