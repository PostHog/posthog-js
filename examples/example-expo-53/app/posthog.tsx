import PostHog from 'posthog-react-native'

// If you want to use Session relay on React Native web, use the posthog-js SDK instead.
// Example:
//
// import posthog from 'posthog-js'
//
// posthog.init(process.env.EXPO_PUBLIC_POSTHOG_PROJECT_API_KEY!, {
//     host: process.env.EXPO_PUBLIC_POSTHOG_API_HOST,
//     debug: true,
// })
//
// export { posthog }

export const posthog = new PostHog(process.env.EXPO_PUBLIC_POSTHOG_PROJECT_API_KEY!, {
    host: process.env.EXPO_PUBLIC_POSTHOG_API_HOST,
    flushAt: 1,
    enableSessionReplay: true,
    captureAppLifecycleEvents: true,
    errorTracking: {
        autocapture: {
            uncaughtExceptions: true,
            unhandledRejections: true,
            console: ['error', 'warn'],
        },
    },
    // Inject X-POSTHOG-DISTINCT-ID and X-POSTHOG-SESSION-ID on outgoing fetch
    // requests to these hostnames. Used by the Tracing Headers screen to verify
    // the patch works end-to-end; see https://posthog.com/docs/llm-analytics/link-session-replay
    addTracingHeaders: ['httpbin.org'],
    // Logs feature config. Off by default — `captureConsoleLogs: true`
    // Server can also enable via remote config, or kill-switch with an explicit `false`.
    //
    // The remaining values are mainly for local dogfooding:
    //   - serviceName / environment / serviceVersion show up as OTLP resource
    //     attrs on every batch, so you can group/filter in the Logs UI and
    //     spot example traffic vs your real apps.
    //   - Try uncommenting `beforeSend` to redact bodies, or
    //     `maxLogsPerInterval` to exercise the rate cap from the Logs tab.
    logs: {
        captureConsoleLogs: true,
        serviceName: 'expo-example',
        environment: 'dev',
        serviceVersion: '0.0.1',
        // beforeSend: (r) => (r.body.includes('skip') ? null : r),
        // maxLogsPerInterval: 5,
        // rateCapWindowMs: 10000,
    },
    // persistence: 'memory',
    // if using WebView, you have to disable masking for text inputs and images
    // sessionReplayConfig: {
    //   maskAllTextInputs: false,
    //   maskAllImages: false,
    // },
})

posthog.debug(true)
