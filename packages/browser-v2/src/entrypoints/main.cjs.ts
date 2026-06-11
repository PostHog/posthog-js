import './default-extensions'
import './external-scripts-loader'
import { initAsModule } from '../posthog-core'
export { PostHog } from '../posthog-core'
export * from '../types'
export * from '../posthog-surveys-types'
export * from '../posthog-product-tours-types'
export * from '../posthog-conversations-types'
export const posthog = initAsModule()
export default posthog
