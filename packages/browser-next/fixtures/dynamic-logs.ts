import { createPostHog } from '@posthog/browser/core'
void import('@posthog/browser/logs').then(async ({ logs }) => {
    const logger = logs()
    await createPostHog({ projectToken: 'ph_test', extensions: [logger] })
    logger.captureLog({ body: 'test' })
})
