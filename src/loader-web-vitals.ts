import { onLCP, onINP, onCLS, onFCP } from 'web-vitals'
import { assignableWindow } from './utils/globals'

// TODO export types here as well?

const postHogWebVitalsCallbacks = {
    onLCP,
    onCLS,
    onFCP,
    onINP,
}
assignableWindow.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

export default postHogWebVitalsCallbacks
