import PostHog from 'posthog-react-native'

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
    sessionReplayConfig: {
        maskAllTextInputs: true,
        maskAllImages: false,
        captureLog: true,
        throttleDelayMs: 1000,
    },
})

posthog.debug(true)
