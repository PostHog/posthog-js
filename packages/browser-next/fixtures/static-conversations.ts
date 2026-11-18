import { createPostHog } from '@posthog/browser/core'
import { conversations } from '@posthog/browser/conversations'
const extension = conversations()
void createPostHog({ projectToken: 'ph_test', extensions: [extension] }).then(() => extension.open())
