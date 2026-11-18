import { createPostHog } from '@posthog/browser/core'
import { errorTracking } from '@posthog/browser/error-tracking'
const tracking = errorTracking({ captureExceptions: true })
void createPostHog({ projectToken: 'ph_test', extensions: [tracking] }).then(() => {
    tracking.addExceptionStep('step')
    tracking.captureException(new Error('test'))
})
