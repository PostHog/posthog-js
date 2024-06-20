import { useContext, useEffect, useMemo, useState } from 'preact/hooks'
import {
    Survey,
    SurveyAppearance,
    SurveyQuestion,
    SurveyQuestionBranchingType,
    SurveyQuestionType,
} from '../../../posthog-surveys-types'
import {
    SurveyContext,
    defaultSurveyAppearance,
    getContrastingTextColor,
    getDisplayOrderQuestions,
    sendSurveyEvent,
} from '../surveys-utils'
import { PostHog } from '../../../posthog-core'
import { OpenTextQuestion, LinkQuestion, RatingQuestion, MultipleChoiceQuestion } from './QuestionTypes'
import { FunctionalComponent, h } from 'preact'

interface QuestionsProps {
    survey: Survey
    forceDisableHtml: boolean
    posthog?: PostHog
    styleOverrides?: React.CSSProperties
    removeSurveyFromFocus: (id: string) => void
}

export const Questions: FunctionalComponent<QuestionsProps> = ({
    survey,
    forceDisableHtml,
    posthog,
    styleOverrides,
    removeSurveyFromFocus,
}) => {
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor
    )
    const [questionsResponses, setQuestionsResponses] = useState({})
    const { isPreviewMode, previewPageIndex } = useContext(SurveyContext)
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(previewPageIndex || 0)
    const surveyQuestions = useMemo(() => getDisplayOrderQuestions(survey), [survey])

    // Sync preview state
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
        if (!posthog) {
            return
        }

        const responseKey =
            originalQuestionIndex === 0 ? `$survey_response` : `$survey_response_${originalQuestionIndex}`

        setQuestionsResponses({ ...questionsResponses, [responseKey]: res })

        const nextStep = posthog.getNextSurveyStep(survey, displayQuestionIndex, res)
        if (nextStep === SurveyQuestionBranchingType.ConfirmationMessage) {
            removeSurveyFromFocus(survey.id)
            sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, posthog)
        } else {
            setCurrentQuestionIndex(nextStep)
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
}: GetQuestionComponentProps): JSX.Element => {
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
