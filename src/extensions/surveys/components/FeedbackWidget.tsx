import { h, FunctionalComponent } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { document as _document } from '../../../utils/globals'
import { Survey } from '../../../posthog-surveys-types'
import { PostHog } from '../../../posthog-core'
import { getContrastingTextColor } from '../surveys-utils'
import { SurveyPopup } from './SurveyPopup'

const document = _document as Document

interface FeedbackWidgetProps {
    survey: Survey
    forceDisableHtml?: boolean
    posthog?: PostHog
    readOnly?: boolean
    removeSurveyFromFocus: (id: string) => void
}

export const FeedbackWidget: FunctionalComponent<FeedbackWidgetProps> = ({
    survey,
    forceDisableHtml,
    posthog,
    readOnly,
    removeSurveyFromFocus,
}): JSX.Element => {
    const [showSurvey, setShowSurvey] = useState(false)
    const [styleOverrides, setStyle] = useState({})
    const widgetRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (readOnly || !posthog) {
            return
        }

        if (survey.appearance?.widgetType === 'tab') {
            if (widgetRef.current) {
                const widgetPos = widgetRef.current.getBoundingClientRect()
                const style = {
                    top: '50%',
                    left: parseInt(`${widgetPos.right - 360}`),
                    bottom: 'auto',
                    borderRadius: 10,
                    borderBottom: `1.5px solid ${survey.appearance?.borderColor || '#c9c6c6'}`,
                }
                setStyle(style)
            }
        }
        if (survey.appearance?.widgetType === 'selector') {
            const widget = document.querySelector(survey.appearance.widgetSelector || '')
            widget?.addEventListener('click', () => {
                setShowSurvey(!showSurvey)
            })
            widget?.setAttribute('PHWidgetSurveyClickListener', 'true')
        }
    }, [])

    return h(
        'div',
        null,
        survey.appearance?.widgetType === 'tab' &&
            h(
                'div',
                {
                    className: 'ph-survey-widget-tab',
                    ref: widgetRef,
                    onClick: () => !readOnly && setShowSurvey(!showSurvey),
                    style: { color: getContrastingTextColor(survey.appearance.widgetColor) },
                },
                h('div', { className: 'ph-survey-widget-tab-icon' }),
                survey.appearance?.widgetLabel || ''
            ),
        showSurvey &&
            h(SurveyPopup, {
                key: 'feedback-widget-survey',
                posthog: posthog,
                survey: survey,
                forceDisableHtml: forceDisableHtml,
                style: styleOverrides,
                removeSurveyFromFocus: removeSurveyFromFocus,
            })
    )
}
