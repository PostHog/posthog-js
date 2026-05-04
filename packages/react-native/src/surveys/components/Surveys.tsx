import React, { useMemo, useState } from 'react'
import { StyleProp, ViewStyle } from 'react-native'

import { getDisplayOrderQuestions, getNextSurveyStep, SurveyAppearanceTheme } from '../surveys-utils'
import {
  Survey,
  SurveyAppearance,
  SurveyQuestion,
  type SurveyResponses,
  maybeAdd,
  SurveyQuestionBranchingType,
} from '@posthog/core'
import {
  buildSurveyResponseProperties,
  getSurveyInteractionProperty,
  getSurveyResponseKey,
  SURVEY_LANGUAGE_PROPERTY,
  surveyHasResponses,
} from '@posthog/core/surveys'
import { LinkQuestion, MultipleChoiceQuestion, OpenTextQuestion, RatingQuestion } from './QuestionTypes'
import { PostHog } from '../../posthog-rn'
import { usePostHog } from '../../hooks/usePostHog'

export const sendSurveyShownEvent = (survey: Survey, posthog: PostHog, surveyLanguage?: string | null): void => {
  posthog.capture('survey shown', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    ...(surveyLanguage ? { [SURVEY_LANGUAGE_PROPERTY]: surveyLanguage } : {}),
  })
}

export const sendSurveyEvent = (
  responses: SurveyResponses = {},
  survey: Survey,
  posthog: PostHog,
  surveyLanguage?: string | null
): void => {
  posthog.capture('survey sent', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    ...(surveyLanguage ? { [SURVEY_LANGUAGE_PROPERTY]: surveyLanguage } : {}),
    ...buildSurveyResponseProperties(responses, survey),
    $set: {
      [getSurveyInteractionProperty(survey, 'responded')]: true,
    },
  })
}

export const dismissedSurveyEvent = (
  survey: Survey,
  responses: SurveyResponses = {},
  posthog: PostHog,
  surveyLanguage?: string | null
): void => {
  posthog.capture('survey dismissed', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    ...(surveyLanguage ? { [SURVEY_LANGUAGE_PROPERTY]: surveyLanguage } : {}),
    $survey_partially_completed: surveyHasResponses(responses),
    ...buildSurveyResponseProperties(responses, survey),
    $set: {
      [getSurveyInteractionProperty(survey, 'dismissed')]: true,
    },
  })
}

export function Questions({
  survey,
  surveyLanguage,
  appearance,
  styleOverrides,
  responses = {},
  onResponsesChange = () => {},
  onSubmit,
}: {
  survey: Survey
  surveyLanguage?: string | null
  appearance: SurveyAppearanceTheme
  styleOverrides?: StyleProp<ViewStyle>
  responses?: SurveyResponses
  onResponsesChange?: (responses: SurveyResponses) => void
  onSubmit: () => void
}): JSX.Element {
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
    const responseKey = getSurveyResponseKey(questionId)

    const allResponses = {
      ...responses,
      [responseKey]: res,
    }
    onResponsesChange(allResponses)

    // Get the next question index based on conditional logic
    const nextStep = getNextSurveyStep(survey, originalQuestionIndex, res)

    if (nextStep === SurveyQuestionBranchingType.End) {
      // End the survey
      sendSurveyEvent(allResponses, survey, posthog, surveyLanguage)
      onSubmit()
    } else {
      // Move to the next question
      setCurrentQuestionIndex(nextStep)
    }
  }

  const question = surveyQuestions[currentQuestionIndex]

  return getQuestionComponent({
    question,
    appearance,
    styleOverrides,
    onSubmit: (res) =>
      onNextButtonClick({
        res,
        originalQuestionIndex: question.originalQuestionIndex,
        questionId: question.id,
      }),
  })
}

type GetQuestionComponentProps = {
  question: SurveyQuestion
  appearance: SurveyAppearance
  styleOverrides?: StyleProp<ViewStyle>
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
