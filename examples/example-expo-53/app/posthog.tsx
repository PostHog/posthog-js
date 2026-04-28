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
    // persistence: 'memory',
    // if using WebView, you have to disable masking for text inputs and images
    // sessionReplayConfig: {
    //   maskAllTextInputs: false,
    //   maskAllImages: false,
    // },
})

posthog.debug(true)
