import { createPostHog } from '@posthog/browser/core'

void createPostHog({ projectToken: 'ph_test' }).then(async (posthog) => {
    posthog.capture('test_event')
    await posthog.flush()
})
