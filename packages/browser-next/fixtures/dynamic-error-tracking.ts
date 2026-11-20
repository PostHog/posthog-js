import { createPostHog } from '@posthog/browser'
void createPostHog({ projectToken: 'ph_test', errorTracking: { captureExceptions: true } }).then((posthog) => {
    posthog.errorTracking?.captureException(new Error('test'))
})
