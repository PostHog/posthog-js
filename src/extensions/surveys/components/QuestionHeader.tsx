import { defaultSurveyAppearance } from '../surveys-utils'
import { cancelSVG } from '../icons'
import { SurveyContext } from '../../surveys'
import { useContext } from 'preact/hooks'

export function QuestionHeader({
    question,
    description,
    backgroundColor,
}: {
    question: string
    description?: string | null
    backgroundColor?: string
}) {
    return (
        <div style={{ backgroundColor: backgroundColor || defaultSurveyAppearance.backgroundColor }}>
            <div className="survey-question">{question}</div>
            {description && <div className="description" dangerouslySetInnerHTML={{ __html: description }} />}
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
