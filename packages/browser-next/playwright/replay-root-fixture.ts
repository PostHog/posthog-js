import { createPostHog } from '@posthog/browser'
import { installReplayHarness } from './replay-harness'
installReplayHarness(createPostHog)
