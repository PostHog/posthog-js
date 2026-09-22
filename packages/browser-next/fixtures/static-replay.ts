import { createPostHog } from '@posthog/browser/core'
import { replay } from '@posthog/browser/replay'
void createPostHog({ projectToken: 'ph_test', extensions: [replay()] }).then((client) => client.capture('test'))
