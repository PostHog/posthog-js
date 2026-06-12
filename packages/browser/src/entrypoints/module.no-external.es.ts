import './default-extensions'
import { init_as_module } from '../posthog-core'

export { PostHog } from '../posthog-core'
export * from '../types'
export * from '../posthog-surveys-types'
export * from '../posthog-product-tours-types'
export * from '../posthog-conversations-types'

/**
 * The default PostHog JavaScript Web SDK singleton instance.
 */
export const posthog = init_as_module()
export default posthog
