import { Survey } from '../posthog-surveys-types'
import { document as _document } from '../utils/globals'
import { SURVEY_DEFAULT_Z_INDEX, addStylesToElement, getContrastingTextColor } from './surveys/surveys-extension-utils'
import widgetStyles from './surveys/widget.css'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const document = _document as Document

export function retrieveWidgetShadow(survey: Survey) {
    const widgetClassName = `PostHogWidget${survey.id}`
    const existingDiv = document.querySelector(`.${widgetClassName}`) as HTMLDivElement | null

    if (existingDiv?.shadowRoot?.querySelector('style[data-ph-widget-style]')) {
        const widgetColor = survey.appearance?.widgetColor || '#e0a045'
        existingDiv.style.setProperty('--ph-widget-color', widgetColor)
        existingDiv.style.setProperty('--ph-widget-text-color', getContrastingTextColor(widgetColor))
        existingDiv.style.setProperty('--ph-widget-z-index', SURVEY_DEFAULT_Z_INDEX.toString())
        return existingDiv.shadowRoot
    }

    const div = existingDiv || document.createElement('div')
    div.className = widgetClassName

    addStylesToElement(div, survey.appearance)

    const widgetColor = survey.appearance?.widgetColor || '#e0a045'
    div.style.setProperty('--ph-widget-color', widgetColor)
    div.style.setProperty('--ph-widget-text-color', getContrastingTextColor(widgetColor))
    div.style.setProperty('--ph-widget-z-index', SURVEY_DEFAULT_Z_INDEX.toString())

    let shadow = div.shadowRoot
    if (!shadow) {
        shadow = div.attachShadow({ mode: 'open' })
    }

    if (!shadow.querySelector('style[data-ph-widget-style]')) {
        const styleElement = document.createElement('style')
        styleElement.setAttribute('data-ph-widget-style', 'true')
        styleElement.textContent = widgetStyles
        shadow.prepend(styleElement)
    }

    if (!existingDiv) {
        document.body.appendChild(div)
    }

    return shadow
}
