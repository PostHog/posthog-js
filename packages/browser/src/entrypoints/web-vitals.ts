import { onINP, onLCP, onCLS, onFCP } from 'web-vitals/attribution'
import { assignableWindow } from '../utils/globals'

const postHogWebVitalsCallbacks = {
    onLCP,
    onCLS,
    onFCP,
    onINP,
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

// we used to put posthogWebVitalsCallbacks on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put it directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

export default postHogWebVitalsCallbacks
