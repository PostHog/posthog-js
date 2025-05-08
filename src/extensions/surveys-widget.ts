import { PostHog } from '../posthog-core'
import { Survey } from '../posthog-surveys-types'
import { document as _document } from '../utils/globals'
import { addSurveyCSSVariablesToElement, getSurveyContainerClass } from './surveys/surveys-extension-utils'
import { prepareStylesheet } from './utils/stylesheet-loader'
import widgetStyles from './surveys/widget.css'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const document = _document as Document

export function retrieveWidgetShadow(survey: Survey, posthog?: PostHog) {
    const widgetClassName = getSurveyContainerClass(survey)
    const existingDiv = document.querySelector(`.${widgetClassName}`) as HTMLDivElement | null

    if (existingDiv && existingDiv.shadowRoot) {
        return existingDiv.shadowRoot
    }

    // If it doesn't exist, create it
    const div = document.createElement('div')
    addSurveyCSSVariablesToElement(div, survey.appearance)
    div.className = widgetClassName
    const shadow = div.attachShadow({ mode: 'open' })
    const stylesheet = createWidgetStylesheet(posthog)
    if (stylesheet) {
        shadow.appendChild(stylesheet)
    }
    document.body.appendChild(div)
    return shadow
}

export function createWidgetStylesheet(posthog?: PostHog) {
    return prepareStylesheet(document, typeof widgetStyles === 'string' ? widgetStyles : '', posthog)
}
