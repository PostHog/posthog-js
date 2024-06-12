import { h, FunctionalComponent } from 'preact'
import { useState, useEffect, useContext, useMemo } from 'preact/hooks'
import { PostHog } from '../../../posthog-core'
import { Survey, SurveyQuestion, SurveyAppearance, SurveyQuestionType } from '../../../posthog-surveys-types'
import SurveyContext from '../contexts/SurveyContext'
import {
    defaultSurveyAppearance,
    getContrastingTextColor,
    getDisplayOrderQuestions,
    sendSurveyEvent,
} from '../surveys-utils'
import { OpenTextQuestion, LinkQuestion, RatingQuestion, MultipleChoiceQuestion } from './QuestionTypes'

interface QuestionsProps {
    survey: Survey
    forceDisableHtml: boolean
    posthog?: PostHog
    styleOverrides?: React.CSSProperties
}

const Questions: FunctionalComponent<QuestionsProps> = ({ survey, forceDisableHtml, posthog, styleOverrides }) => {
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor
    )
    const [questionsResponses, setQuestionsResponses] = useState<Record<string, any>>({})
    const { isPreviewMode, previewPageIndex } = useContext(SurveyContext)
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(previewPageIndex || 0)
    const surveyQuestions = useMemo(() => getDisplayOrderQuestions(survey), [survey])

    useEffect(() => {
        setCurrentQuestionIndex(previewPageIndex ?? 0)
    }, [previewPageIndex])

    const onNextButtonClick = ({
        res,
        originalQuestionIndex,
        displayQuestionIndex,
    }: {
        res: string | string[] | number | null
        originalQuestionIndex: number
        displayQuestionIndex: number
    }) => {
        const isLastDisplayedQuestion = displayQuestionIndex === survey.questions.length - 1
        const responseKey =
            originalQuestionIndex === 0 ? `$survey_response` : `$survey_response_${originalQuestionIndex}`

        if (isLastDisplayedQuestion) {
            return sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, posthog)
        } else {
            setQuestionsResponses({ ...questionsResponses, [responseKey]: res })
            setCurrentQuestionIndex(displayQuestionIndex + 1)
        }
    }

    return h(
        'form',
        {
            className: 'survey-form',
            style: {
                color: textColor,
                borderColor: survey.appearance?.borderColor,
                ...styleOverrides,
            },
        },
        surveyQuestions.map((question, displayQuestionIndex) => {
            const { originalQuestionIndex } = question

            const isVisible = isPreviewMode
                ? currentQuestionIndex === originalQuestionIndex
                : currentQuestionIndex === displayQuestionIndex
            return (
                isVisible &&
                h(
                    'div',
                    null,
                    getQuestionComponent({
                        question,
                        forceDisableHtml,
                        displayQuestionIndex,
                        appearance: survey.appearance || defaultSurveyAppearance,
                        onSubmit: (res) =>
                            onNextButtonClick({
                                res,
                                originalQuestionIndex,
                                displayQuestionIndex,
                            }),
                    })
                )
            )
        })
    )
}

export default Questions

interface GetQuestionComponentProps {
    question: SurveyQuestion
    forceDisableHtml: boolean
    displayQuestionIndex: number
    appearance: SurveyAppearance
    onSubmit: (res: string | string[] | number | null) => void
}

const getQuestionComponent = ({
    question,
    forceDisableHtml,
    displayQuestionIndex,
    appearance,
    onSubmit,
}: GetQuestionComponentProps): h.JSX.Element => {
    const questionComponents: Record<SurveyQuestionType, FunctionalComponent<any>> = {
        [SurveyQuestionType.Open]: OpenTextQuestion,
        [SurveyQuestionType.Link]: LinkQuestion,
        [SurveyQuestionType.Rating]: RatingQuestion,
        [SurveyQuestionType.SingleChoice]: MultipleChoiceQuestion,
        [SurveyQuestionType.MultipleChoice]: MultipleChoiceQuestion,
    }

    const commonProps = {
        question,
        forceDisableHtml,
        appearance,
        onSubmit,
    }

    const additionalProps: Record<SurveyQuestionType, any> = {
        [SurveyQuestionType.Open]: {},
        [SurveyQuestionType.Link]: {},
        [SurveyQuestionType.Rating]: { displayQuestionIndex },
        [SurveyQuestionType.SingleChoice]: { displayQuestionIndex },
        [SurveyQuestionType.MultipleChoice]: { displayQuestionIndex },
    }

    const Component = questionComponents[question.type]
    const componentProps = { ...commonProps, ...additionalProps[question.type] }

    return h(Component, componentProps)
}
