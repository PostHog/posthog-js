import { h } from 'preact'
import { useContext } from 'preact/hooks'
import { SurveyQuestion, SurveyQuestionType } from '../../../posthog-surveys-types'
import { cancelSVG } from '../icons'
import { SurveyContext, renderChildrenAsTextOrHtml } from '../surveys-extension-utils'

export function QuestionHeader({
    question,
    forceDisableHtml,
    htmlFor,
}: {
    question: Pick<SurveyQuestion, 'question' | 'description' | 'descriptionContentType' | 'type'>
    forceDisableHtml: boolean
    htmlFor?: string
}) {
    const TitleComponent = question.type === SurveyQuestionType.Open ? 'label' : 'h3'
    return (
        <div class="question-header">
            <TitleComponent className="survey-question" htmlFor={htmlFor}>
                {question.question}
            </TitleComponent>
            {question.description &&
                renderChildrenAsTextOrHtml({
                    component: h('p', { className: 'survey-question-description' }),
                    children: question.description,
                    renderAsHtml: !forceDisableHtml && question.descriptionContentType !== 'text',
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
