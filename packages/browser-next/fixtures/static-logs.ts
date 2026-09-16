import { createPostHog } from '@posthog/browser/core'
import { logs } from '@posthog/browser/logs'
void createPostHog({ projectToken: 'ph_test', extensions: [logs()] }).then((posthog) =>
    posthog.captureLog({ body: 'test' })
)
