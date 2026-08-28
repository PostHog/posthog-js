import { createPostHog } from '@posthog/browser/core'

void createPostHog({ projectToken: 'ph_test' }).then((posthog) => posthog.capture('test_event'))
