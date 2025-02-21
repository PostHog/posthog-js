import { PostHog } from '../../posthog-core'
import { document } from '../../utils/globals'
import { createLogger } from '../../utils/logger'

const logger = createLogger('[Stylesheet Loader]')

export const prepareStylesheet = (innerText: string, posthog?: PostHog) => {
    // Forcing the existence of `document` requires this function to be called in a browser environment
    let stylesheet: HTMLStyleElement | null = document!.createElement('style')
    stylesheet.innerText = innerText

    if (posthog?.config.prepare_external_dependency_stylesheet) {
        stylesheet = posthog.config.prepare_external_dependency_stylesheet(stylesheet)
    }

    if (!stylesheet) {
        logger.error('prepare_external_dependency_stylesheet returned null')
        return null
    }

    return stylesheet
}
