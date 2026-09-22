import { createPostHog } from '@posthog/browser/core'
import { installReplayHarness } from './replay-harness'
installReplayHarness(createPostHog)
