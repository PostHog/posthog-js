import React, { useMemo, useState } from 'react'
import { ScrollView, StyleProp, ViewStyle } from 'react-native'

import { getDisplayOrderQuestions, getNextSurveyStep, SurveyAppearanceTheme } from '../surveys-utils'
import {
  Survey,
  SurveyAppearance,
  SurveyQuestion,
  maybeAdd,
  SurveyQuestionBranchingType,
  isUndefined,
} from '@posthog/core'
import { LinkQuestion, MultipleChoiceQuestion, OpenTextQuestion, RatingQuestion } from './QuestionTypes'
import { PostHog } from '../../posthog-rn'
import { usePostHog } from '../../hooks/usePostHog'

const getSurveyInteractionProperty = (survey: Survey, action: string): string => {
  let surveyProperty = `$survey_${action}/${survey.id}`
  if (survey.current_iteration && survey.current_iteration > 0) {
    surveyProperty = `$survey_${action}/${survey.id}/${survey.current_iteration}`
  }

  return surveyProperty
}

export const sendSurveyShownEvent = (survey: Survey, posthog: PostHog): void => {
  posthog.capture('survey shown', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
  })
}

function getSurveyNewResponseKey(questionId: string) {
  return `$survey_response_${questionId}`
}

function getSurveyOldResponseKey(originalQuestionIndex: number) {
  return originalQuestionIndex === 0 ? '$survey_response' : `$survey_response_${originalQuestionIndex}`
}

const getSurveyResponseValue = (responses: Record<string, string | number | string[] | null>, questionId?: string) => {
  if (!questionId) {
    return null
  }
  const response = responses[getSurveyNewResponseKey(questionId)]
  if (Array.isArray(response)) {
    return [...response]
  }
  return response
}

export const sendSurveyEvent = (
  responses: Record<string, string | number | string[] | null> = {},
  survey: Survey,
  posthog: PostHog
): void => {
  // map question ids also to the old format for back compatibility
  const oldFormatResponses: Record<string, string | number | string[] | null> = {}
  survey.questions.forEach((question: SurveyQuestion) => {
    const oldResponseKey = getSurveyOldResponseKey(question.originalQuestionIndex)
    const response = getSurveyResponseValue(responses, question.id)
    if (!isUndefined(response)) {
      oldFormatResponses[oldResponseKey] = response
    }
  })
  const allResponses = {
    ...responses,
    ...oldFormatResponses,
  }

  posthog.capture('survey sent', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    $survey_questions: survey.questions.map((question: SurveyQuestion) => ({
      id: question.id,
      question: question.question,
      response: getSurveyResponseValue(responses, question.id),
    })),
    ...allResponses,
    $set: {
      [getSurveyInteractionProperty(survey, 'responded')]: true,
    },
  })
}

export const dismissedSurveyEvent = (survey: Survey, posthog: PostHog): void => {
  posthog.capture('survey dismissed', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    $set: {
      [getSurveyInteractionProperty(survey, 'dismissed')]: true,
    },
  })
}

export function Questions({
  survey,
  appearance,
  styleOverrides,
  onSubmit,
}: {
  survey: Survey
  appearance: SurveyAppearanceTheme
  styleOverrides?: StyleProp<ViewStyle>
  onSubmit: () => void
}): JSX.Element {
  const [questionsResponses, setQuestionsResponses] = useState({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const surveyQuestions = useMemo(() => getDisplayOrderQuestions(survey), [survey])
  const posthog = usePostHog()

  const onNextButtonClick = ({
    res,
    originalQuestionIndex,
    questionId,
  }: // displayQuestionIndex,
  {
    res: string | string[] | number | null
    originalQuestionIndex: number
    questionId: string
    // displayQuestionIndex: number
  }): void => {
    const responseKey = getSurveyNewResponseKey(questionId)

    const allResponses = {
      ...questionsResponses,
      [responseKey]: res,
    }
    setQuestionsResponses(allResponses)

    // Get the next question index based on conditional logic
    const nextStep = getNextSurveyStep(survey, originalQuestionIndex, res)

    if (nextStep === SurveyQuestionBranchingType.End) {
      // End the survey
      sendSurveyEvent(allResponses, survey, posthog)
      onSubmit()
    } else {
      // Move to the next question
      setCurrentQuestionIndex(nextStep)
    }
  }

  const question = surveyQuestions[currentQuestionIndex]

  return (
    <ScrollView
      style={[styleOverrides, { flexGrow: 0 }]}
      keyboardShouldPersistTaps="handled" // do not dismiss keyboard on submit button tap
    >
      {getQuestionComponent({
        question,
        appearance,
        onSubmit: (res) =>
          onNextButtonClick({
            res,
            originalQuestionIndex: question.originalQuestionIndex,
            questionId: question.id,
            // displayQuestionIndex: currentQuestionIndex,
          }),
      })}
    </ScrollView>
  )
}

type GetQuestionComponentProps = {
  question: SurveyQuestion
  appearance: SurveyAppearance
  onSubmit: (res: string | string[] | number | null) => void
}

const getQuestionComponent = (props: GetQuestionComponentProps): JSX.Element => {
  const questionComponents = {
    open: OpenTextQuestion,
    link: LinkQuestion,
    rating: RatingQuestion,
    multiple_choice: MultipleChoiceQuestion,
    single_choice: MultipleChoiceQuestion,
  }

  const Component = questionComponents[props.question.type]

  return <Component key={props.question.originalQuestionIndex} {...(props as any)} />
}
