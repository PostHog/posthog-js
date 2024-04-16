// Same as loader-array.ts except it uses PostHogCore instead of PostHogExtended
import { POSTHOG_INSTANCES, PostHogCore } from '../posthog-core'
import { init_from_snippet } from './loader-helpers'

init_from_snippet(PostHogCore, POSTHOG_INSTANCES)
