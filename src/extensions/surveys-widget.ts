import { Survey } from '../posthog-surveys-types'
import { document as _document } from '../utils/globals'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const document = _document as Document

export function createWidgetShadow(survey: Survey) {
    const div = document.createElement('div')
    div.className = `PostHogWidget${survey.id}`
    const shadow = div.attachShadow({ mode: 'open' })
    const widgetStyleSheet = createWidgetStyle(survey.appearance?.widgetColor)
    shadow.append(Object.assign(document.createElement('style'), { innerText: widgetStyleSheet }))
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
            z-index: 9999999;
        }
        .ph-survey-widget-tab:hover {
            padding-bottom: 13px;
        }
        .ph-survey-widget-button {
            position: fixed;
        }
    `
}
