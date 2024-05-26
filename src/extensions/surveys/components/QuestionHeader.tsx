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
            {description && descriptionContentType && descriptionContentType === 'html' ? (
                // at this point, description is guaranteed to be a string and descriptionContentType is guaranteed to be 'html'
                // so we can just use dangerouslySetInnerHTML
                <div className="description" dangerouslySetInnerHTML={{ __html: description }} />
            ) : (
                // at this point, description is guaranteed to be a string and descriptionContentType is guaranteed to be 'text'
                // so we should just render it as text
                <div className="description">{description}</div>
            )}
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
