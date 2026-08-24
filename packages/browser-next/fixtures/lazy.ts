import { createPostHog } from '@posthog/browser'

void createPostHog({ projectToken: 'ph_test' }).then(async (posthog) => {
    await posthog.capture('test_event')
    const { analytics } = await import('@posthog/browser/analytics')
    await posthog.installExtension(analytics())
    await posthog.flush()
})
