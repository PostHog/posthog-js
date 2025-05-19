import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { cancelSVG } from '../icons'
import { SurveyContext, renderChildrenAsTextOrHtml } from '../surveys-extension-utils'

export function QuestionHeader({
    question,
    description,
    descriptionContentType,
    forceDisableHtml,
}: {
    question: string
    description?: string | null
    descriptionContentType?: SurveyQuestionDescriptionContentType
    forceDisableHtml: boolean
}) {
    return (
        <div className="question-header">
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
        <button
            className="form-cancel"
            onClick={onClick}
            disabled={isPreviewMode}
            aria-label="Close survey"
            type="button"
        >
            {cancelSVG}
        </button>
    )
}
