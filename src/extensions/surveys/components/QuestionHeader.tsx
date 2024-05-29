import { SurveyContext, defaultSurveyAppearance } from '../surveys-utils'
import { cancelSVG } from '../icons'
import { useContext } from 'preact/hooks'
import { SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'

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
            {description ? (
                descriptionContentType === 'text' ? (
                    <div className="description">{description}</div>
                ) : (
                    // Treat as HTML if content type is 'html' or not specified
                    <div className="description" dangerouslySetInnerHTML={{ __html: description }} />
                )
            ) : null}
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
