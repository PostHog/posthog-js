import { SurveyContext, defaultSurveyAppearance, renderChildrenAsTextOrHtml } from '../surveys-utils'
import { cancelSVG } from '../icons'
import { useContext } from 'preact/hooks'
import { SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { h } from 'preact'

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
    return (
        <div style={{ backgroundColor: backgroundColor || defaultSurveyAppearance.backgroundColor }}>
            <div className="survey-question">{question}</div>
            {description &&
                renderChildrenAsTextOrHtml({
                    component: h('div', { className: 'description' }),
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
            <button className="form-cancel" onClick={onClick} disabled={isPreviewMode}>
                {cancelSVG}
            </button>
        </div>
    )
}
