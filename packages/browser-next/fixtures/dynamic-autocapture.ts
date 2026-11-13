import { createPostHog } from '@posthog/browser/core'
void Promise.all([import('@posthog/browser/autocapture'), import('@posthog/browser/analytics')]).then(
    async ([{ autocapture }, { analytics }]) => {
        const posthog = await createPostHog({ projectToken: 'ph_test', extensions: [analytics(), autocapture()] })
        posthog.analytics?.capture('test')
    }
)
