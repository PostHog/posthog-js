// Same as loader-globals.ts except includes rrweb scripts.
import { POSTHOG_INSTANCES, PostHogCore } from '../posthog-core'
import { init_from_snippet } from './loader-helpers'

init_from_snippet(PostHogCore, POSTHOG_INSTANCES)
