import { createPostHog } from '@posthog/browser/core'
import { toolbar } from '@posthog/browser/toolbar'
void createPostHog({ projectToken: 'ph_test', extensions: [toolbar()] }).then((posthog) =>
    posthog.toolbar?.loadToolbar()
)
