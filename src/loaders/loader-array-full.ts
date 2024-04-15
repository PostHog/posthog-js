// Same as loader-globals.ts except includes rrweb scripts.

import './loader-recorder'
import { PostHogExtended } from '../posthog-extended'
import { POSTHOG_INSTANCES } from '../posthog-core'
import { init_from_snippet } from './loader-helpers'

init_from_snippet(PostHogExtended, POSTHOG_INSTANCES)
