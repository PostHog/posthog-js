import React, { useMemo, useState } from 'react'
import { StyleProp, ViewStyle } from 'react-native'

import { getNextSurveyStep, SurveyAppearanceTheme } from '../surveys-utils'
import { getDisplayOrderQuestions, shouldShuffleQuestions } from '../survey-shuffling'
import { Survey, SurveyQuestion, type SurveyResponses, maybeAdd, SurveyQuestionBranchingType } from '@posthog/core'
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

// Events receive the configured survey, not its shuffled display copies. Supply
// positional indices here so legacy response properties do not depend on rendering.
const buildConfiguredSurveyResponseProperties = (responses: SurveyResponses, survey: Survey) =>
  buildSurveyResponseProperties(responses, {
    questions: survey.questions.map((question, originalQuestionIndex) => ({
      ...question,
      originalQuestionIndex,
    })),
  })

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
    ...buildConfiguredSurveyResponseProperties(responses, survey),
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
    ...buildConfiguredSurveyResponseProperties(responses, survey),
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
  const questionsAreShuffled = shouldShuffleQuestions(survey)
  const posthog = usePostHog()

  const onNextButtonClick = ({
    res,
    originalQuestionIndex,
    questionId,
  }: {
    res: string | string[] | number | null
    originalQuestionIndex: number
    questionId: string
  }): void => {
    const responseKey = getSurveyResponseKey(questionId)

    const allResponses = {
      ...responses,
      [responseKey]: res,
    }
    onResponsesChange(allResponses)

    // Shuffled surveys cannot use branching and must advance through display order.
    // Non-shuffled surveys retain the configured/original-index branching semantics.
    if (questionsAreShuffled) {
      if (currentQuestionIndex === surveyQuestions.length - 1) {
        sendSurveyEvent(allResponses, survey, posthog, surveyLanguage)
        onSubmit()
      } else {
        setCurrentQuestionIndex((index) => index + 1)
      }
      return
    }

    const nextStep = getNextSurveyStep(survey, originalQuestionIndex, res)

    if (nextStep === SurveyQuestionBranchingType.End) {
      sendSurveyEvent(allResponses, survey, posthog, surveyLanguage)
      onSubmit()
    } else {
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
  // The question components each declare `SurveyAppearanceTheme`; typing this
  // intermediate as the shared `SurveyAppearance` dropped every React
  // Native-only field, which the `as any` below then hid.
  appearance: SurveyAppearanceTheme
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
