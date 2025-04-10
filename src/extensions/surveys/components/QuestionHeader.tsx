import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { cancelSVG } from '../icons'
import { SurveyContext, defaultSurveyAppearance, renderChildrenAsTextOrHtml } from '../surveys-extension-utils'

export function QuestionHeader({
    question,
    description,
    descriptionContentType,
    backgroundColor,
    forceDisableHtml,
}: {
    question: string
    description?: string | null
    descriptionContentType?: SurveyQuestionDescriptionContentType
    forceDisableHtml: boolean
    backgroundColor?: string
}) {
    const { isPopup } = useContext(SurveyContext)
    return (
        <div style={isPopup ? { backgroundColor: backgroundColor || defaultSurveyAppearance.backgroundColor } : {}}>
            <div className="survey-question">{question}</div>
            {description &&
                renderChildrenAsTextOrHtml({
                    component: h('div', { className: 'survey-question-description' }),
                    children: description,
                    renderAsHtml: !forceDisableHtml && descriptionContentType !== 'text',
                })}
        </div>
    )
}

export function Cancel({ onClick }: { onClick: () => void }) {
    const { isPreviewMode } = useContext(SurveyContext)

    return (
        <div className="cancel-btn-wrapper">
            <button
                className="form-cancel"
                onClick={onClick}
                disabled={isPreviewMode}
                aria-label="Close survey"
                role="button"
            >
                {cancelSVG}
            </button>
        </div>
    )
}
