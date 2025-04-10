import { PostHog } from '../posthog-core'
import { Survey } from '../posthog-surveys-types'
import { document as _document } from '../utils/globals'
import { SURVEY_DEFAULT_Z_INDEX } from './surveys/surveys-extension-utils'
import { prepareStylesheet } from './utils/stylesheet-loader'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const document = _document as Document

export function createWidgetShadow(survey: Survey, posthog?: PostHog) {
    const div = document.createElement('div')
    div.className = `PostHogWidget${survey.id}`
    const shadow = div.attachShadow({ mode: 'open' })
    const widgetStyleSheet = createWidgetStyle(survey.appearance?.widgetColor)

    const stylesheet = prepareStylesheet(document, widgetStyleSheet, posthog)
    if (stylesheet) {
        shadow.append(stylesheet)
    }

    document.body.appendChild(div)
    return shadow
}

export function createWidgetStyle(widgetColor?: string) {
    return `
        .ph-survey-widget-tab {
            position: fixed;
            top: 50%;
            right: 0;
            background: ${widgetColor || '#e0a045'};
            color: white;
            transform: rotate(-90deg) translate(0, -100%);
            transform-origin: right top;
            min-width: 40px;
            padding: 8px 12px;
            font-weight: 500;
            border-radius: 3px 3px 0 0;
            text-align: center;
            cursor: pointer;
            z-index: ${SURVEY_DEFAULT_Z_INDEX};
        }
        .ph-survey-widget-tab:hover {
            padding-bottom: 13px;
        }
        .ph-survey-widget-button {
            position: fixed;
        }
    `
}
