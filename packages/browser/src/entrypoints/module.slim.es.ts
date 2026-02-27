/* eslint-disable-next-line no-console */
console.warn(
    '[PostHog Experimental] The slim module is experimental and may break or change on any release. Please use with caution and report any issues you encounter.'
)
import './external-scripts-loader'
import posthog from './module.slim.no-external.es'
export * from './module.slim.no-external.es'
export default posthog
