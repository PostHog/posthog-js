import { init_as_module } from './posthog-core'
export { PostHog } from './posthog-core'
export * from './types'
export * from './posthog-surveys-types'
export { renderSurveysPreview } from './extensions/surveys'
export const posthog = init_as_module()
export default posthog
