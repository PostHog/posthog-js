import { init_as_module } from '../posthog-core'

declare module '@posthog/types' {
    interface TreeShakeableConfig {
        optional: true
    }
}

export { PostHog } from '../posthog-core'
export * from '../types'
export * from '../posthog-surveys-types'
export * from '../posthog-product-tours-types'
export * from '../posthog-conversations-types'
export const posthog = init_as_module()
export default posthog
