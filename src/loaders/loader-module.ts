import { POSTHOG_INSTANCES } from '../posthog-core'

import { init_as_module } from '../loaders/loader-helpers'
import { PostHogExtended } from '../posthog-extended'

export * from '../types'
export * from '../posthog-surveys-types'
export const posthog = init_as_module(PostHogExtended, POSTHOG_INSTANCES)

export { PostHogExtended as PostHog }
export default posthog
