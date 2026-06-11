import { PostHog } from '../../posthog-core'
import { createLogger } from '../../utils/logger'

const logger = createLogger('[Stylesheet Loader]')

export const prepareStylesheet = (document: Document, innerText: string, posthog?: PostHog) => {
    // Forcing the existence of `document` requires this function to be called in a browser environment
    let stylesheet: HTMLStyleElement | null = document.createElement('style')
    stylesheet.innerText = innerText

    if (posthog?.config?.prepareExternalDependencyStylesheet) {
        stylesheet = posthog.config.prepareExternalDependencyStylesheet(stylesheet)
    }

    if (!stylesheet) {
        logger.error('prepareExternalDependencyStylesheet returned null')
        return null
    }

    return stylesheet
}
