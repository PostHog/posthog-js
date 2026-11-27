import { createPostHog } from '@posthog/browser/core'
import { cookiePersistence } from '@posthog/browser/persistence/cookie'

void createPostHog({ projectToken: 'ph_test', cookie: cookiePersistence() }).then(async (posthog) => {
    posthog.capture('test_event')
    await posthog.flush()
})
