import {  POSTHOG_INSTANCES, PostHogCore } from '../posthog-core'

import { init_as_module } from '../loaders/loader-helpers'

export * from '../types'
export * from '../posthog-surveys-types'
export const posthog = init_as_module(PostHogCore, POSTHOG_INSTANCES)
export default posthog
