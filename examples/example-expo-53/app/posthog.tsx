import PostHog from 'posthog-react-native'

export const posthog = new PostHog(process.env.EXPO_PUBLIC_POSTHOG_PROJECT_KEY!, {
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

    // if using WebView, you have to disable masking for text inputs and images
    // sessionReplayConfig: {
    //   maskAllTextInputs: false,
    //   maskAllImages: false,
    // },
})

posthog.debug(true)
