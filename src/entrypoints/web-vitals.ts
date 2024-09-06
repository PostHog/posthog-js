import { onLCP, onCLS, onFCP } from 'web-vitals'
import { onINP } from 'web-vitals/attribution'
import { assignableWindow } from '../utils/globals'

const postHogWebVitalsCallbacks = {
    onLCP,
    onCLS,
    onFCP,
    onINP,
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__POSTHOG_EXTENSIONS__postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

export default postHogWebVitalsCallbacks
