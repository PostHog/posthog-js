import { isFunction } from '@posthog/core'

import { createLogger } from './logger'

const logger = createLogger('[Stylesheet Loader]')

export type StylesheetPreparer = (stylesheet: HTMLStyleElement) => HTMLStyleElement | null
export type StylesheetPreparationContext =
    | StylesheetPreparer
    | {
          config?: {
              prepare_external_dependency_stylesheet?: StylesheetPreparer
          }
      }

const getStylesheetPreparer = (context?: StylesheetPreparationContext): StylesheetPreparer | undefined => {
    if (isFunction(context)) {
        return context
    }
    return context?.config?.prepare_external_dependency_stylesheet
}

export const prepareStylesheet = (
    document: Document,
    innerText: string,
    context?: StylesheetPreparationContext
): HTMLStyleElement | null => {
    // Forcing the existence of `document` requires this function to be called in a browser environment
    let stylesheet: HTMLStyleElement | null = document.createElement('style')
    stylesheet.innerText = innerText

    const prepareExternalDependencyStylesheet = getStylesheetPreparer(context)
    if (prepareExternalDependencyStylesheet) {
        try {
            stylesheet = prepareExternalDependencyStylesheet(stylesheet)
        } catch (error) {
            // A failing customer callback leaves the UI unstyled rather than breaking its rendering.
            logger.error('prepare_external_dependency_stylesheet failed', error)
            return null
        }
    }

    if (!stylesheet) {
        logger.error('prepare_external_dependency_stylesheet returned null')
        return null
    }

    return stylesheet
}
