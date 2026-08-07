import { createPostHog } from '@posthog/browser'

void createPostHog('ph_test').then((posthog) => posthog.capture('test_event'))
