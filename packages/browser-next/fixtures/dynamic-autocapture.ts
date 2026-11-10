import { createPostHog } from '@posthog/browser/core'
void import('@posthog/browser/autocapture').then(async ({ autocapture }) => {
    const posthog = await createPostHog({ projectToken: 'ph_test', extensions: [autocapture()] })
    posthog.capture('test')
})
