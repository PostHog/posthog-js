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
            console: false,
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
