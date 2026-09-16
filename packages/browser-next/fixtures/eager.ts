import { createPostHog } from '@posthog/browser/core'
import { analytics } from '@posthog/browser/analytics'

void createPostHog({ projectToken: 'ph_test', extensions: [analytics()] }).then(async (posthog) => {
    posthog.capture('test_event')
    await posthog.flush()
})
