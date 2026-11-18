import { createPostHog } from '@posthog/browser'

void createPostHog({ projectToken: 'ph_test' }).then(async (posthog) => {
    const analytics = await posthog.resolveExtension('analytics')
    analytics?.capture('test_event')
    await posthog.flush()
})
