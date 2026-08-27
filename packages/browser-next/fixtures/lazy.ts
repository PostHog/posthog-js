import { createPostHog } from '@posthog/browser'

void createPostHog({ projectToken: 'ph_test' }).then(async (posthog) => {
    await posthog.capture('test_event')
    await posthog.flush()
})
