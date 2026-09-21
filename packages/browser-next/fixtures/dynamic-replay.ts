import { createPostHog } from '@posthog/browser/core'
void import('@posthog/browser/replay').then(async ({ replay }) => {
    const client = await createPostHog({ projectToken: 'ph_test', extensions: [replay()] })
    client.capture('test')
})
