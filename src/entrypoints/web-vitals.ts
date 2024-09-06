import { onLCP, onCLS, onFCP } from 'web-vitals'
import { onINP } from 'web-vitals/attribution'
import { assignableWindow } from '../utils/globals'

// TODO export types here as well?

const postHogWebVitalsCallbacks = {
    onLCP,
    onCLS,
    onFCP,
    onINP,
}

assignableWindow.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

export default postHogWebVitalsCallbacks
