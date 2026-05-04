import PostHog from 'posthog-react-native'

/**
 * Module-level beforeSend mode for the dev-tools panel in /logs. The
 * `beforeSend` filter below reads this on every capture, so flipping
 * `beforeSendMode.current` from another file changes filter behavior at
 * runtime without reaching into SDK internals. Demonstrates the closure
 * pattern customers should use for any runtime-tunable filter.
 */
export const beforeSendMode: { current: 'pass' | 'drop' | 'throw' } = { current: 'pass' }

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
    logs: {
        serviceName: 'expo-example',
        environment: 'dev',
        serviceVersion: '0.0.1',
        // The /logs dev-tools panel toggles `beforeSendMode.current` at
        // runtime. The closure here reads it on every capture, so the
        // behavior switches without re-constructing the SDK or touching
        // private internals. Customers wiring runtime-tunable filters
        // should follow this pattern.
        beforeSend: (record) => {
            if (beforeSendMode.current === 'drop') return null
            if (beforeSendMode.current === 'throw') throw new Error('beforeSend boom')
            return record
        },
    },
    // persistence: 'memory',
    // if using WebView, you have to disable masking for text inputs and images
    // sessionReplayConfig: {
    //   maskAllTextInputs: false,
    //   maskAllImages: false,
    // },
})

posthog.debug(true)
