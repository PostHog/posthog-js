import { createPostHog } from '@posthog/browser/core'
import { replay } from '@posthog/browser/replay'
import { installReplayHarness } from './replay-harness'
installReplayHarness(createPostHog, replay)
