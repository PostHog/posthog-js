import { createPostHog } from '@posthog/browser/core'
void import('@posthog/browser/logs').then(async ({ logs }) => {
    const posthog = await createPostHog({ projectToken: 'ph_test', extensions: [logs()] })
    posthog.captureLog({ body: 'test' })
})
