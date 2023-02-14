import './loader-recorder'
import { init_as_module } from './posthog-core'
export { PostHog } from './posthog-core'
export * from './types'
export const posthog = init_as_module()
export default posthog
