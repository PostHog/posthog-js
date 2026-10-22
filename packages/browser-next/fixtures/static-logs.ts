import { createPostHog } from '@posthog/browser/core'
import { logs } from '@posthog/browser/logs'
const logger = logs()
void createPostHog({ projectToken: 'ph_test', extensions: [logger] }).then(() => logger.captureLog({ body: 'test' }))
