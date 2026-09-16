import { createPostHog } from '@posthog/browser/core'

void import('@posthog/browser/flags').then(async ({ flags }) => {
    const posthog = await createPostHog({ projectToken: 'ph_test', extensions: [flags()] })
    posthog.getFeatureFlag('test')
})
