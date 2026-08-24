import { createPostHog } from '@posthog/browser'
import { analytics } from '@posthog/browser/analytics'

void createPostHog({ projectToken: 'ph_test', extensions: [analytics()] }).then(async (posthog) => {
    await posthog.capture('test_event')
    await posthog.flush()
})
