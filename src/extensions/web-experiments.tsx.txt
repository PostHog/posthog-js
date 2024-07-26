import { PostHog } from '../posthog-core'
import { window as _window, document as _document } from '../utils/globals'
import { PosthogExperiments } from '../posthog-experiments'

export function generateWebExperiments(posthog: PostHog) {
    // NOTE: Important to ensure we never try and run web experiments without a window environment
    if (!document || !window) {
        return
    }

    const experimentManager = new PosthogExperiments(posthog)
    experimentManager.getWebExperimentsAndEvaluateDisplayLogic(false)

    // TODO (PHANI): Gotta do something with the mutation observer here to ensure that
    // we can apply web experiments to any new elements loaded into the page.
    // recalculate web experiments every second to check if URL or selectors have changed
    setInterval(() => {
        experimentManager.getWebExperimentsAndEvaluateDisplayLogic(false)
    }, 1000)
}
