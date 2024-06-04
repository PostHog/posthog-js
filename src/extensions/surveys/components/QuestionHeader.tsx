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
}: {
    question: string
    description?: string | null
    descriptionContentType?: SurveyQuestionDescriptionContentType
    backgroundColor?: string
}) {
    return (
        <div style={{ backgroundColor: backgroundColor || defaultSurveyAppearance.backgroundColor }}>
            <div className="survey-question">{question}</div>
            {description &&
                renderChildrenAsTextOrHtml({
                    component: h('div', { className: 'description' }),
                    children: description,
                    renderAsHtml: descriptionContentType !== 'text',
                })}
        </div>
    )
}

export function Cancel({ onClick }: { onClick: () => void }) {
    const { readOnly } = useContext(SurveyContext)

    return (
        <div className="cancel-btn-wrapper">
            <button className="form-cancel" onClick={onClick} disabled={readOnly}>
                {cancelSVG}
            </button>
        </div>
    )
}
