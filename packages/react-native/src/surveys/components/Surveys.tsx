import React, { useMemo, useRef, useState } from 'react'
import { StyleProp, ViewStyle } from 'react-native'

import { getNextSurveyStep, SurveyAppearanceTheme } from '../surveys-utils'
import { shouldShuffleQuestions } from '../survey-shuffling'
import { canCaptureSurvey, createSurveyProgress, SurveyProgress } from '../survey-progress'
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

// Events receive the configured survey, not its shuffled display copies. Supply
// positional indices here so legacy response properties do not depend on rendering.
const buildConfiguredSurveyResponseProperties = (
  responses: SurveyResponses,
  survey: Survey,
  snapshots?: Record<string, string>
) =>
  buildSurveyResponseProperties(
    responses,
    {
      questions: survey.questions.map((question, originalQuestionIndex) => ({
        ...question,
        originalQuestionIndex,
      })),
    },
    snapshots
  )

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
  surveyLanguage?: string | null,
  progress?: SurveyProgress,
  completed = true
): void => {
  posthog.capture('survey sent', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    ...(surveyLanguage ? { [SURVEY_LANGUAGE_PROPERTY]: surveyLanguage } : {}),
    ...(progress ? { $survey_submission_id: progress.submissionId, $survey_completed: completed } : {}),
    ...buildConfiguredSurveyResponseProperties(responses, survey, progress?.questionSnapshots),
    $set: {
      [getSurveyInteractionProperty(survey, 'responded')]: true,
    },
  })
}

export const dismissedSurveyEvent = (
  survey: Survey,
  responses: SurveyResponses = {},
  posthog: PostHog,
  surveyLanguage?: string | null,
  progress?: SurveyProgress
): void => {
  posthog.capture('survey dismissed', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    ...(surveyLanguage ? { [SURVEY_LANGUAGE_PROPERTY]: surveyLanguage } : {}),
    $survey_partially_completed: surveyHasResponses(responses),
    ...(progress ? { $survey_submission_id: progress.submissionId } : {}),
    ...buildConfiguredSurveyResponseProperties(responses, survey, progress?.questionSnapshots),
    $set: {
      [getSurveyInteractionProperty(survey, 'dismissed')]: true,
    },
  })
}

function nextQuestion(
  survey: Survey,
  progress: SurveyProgress,
  originalQuestionIndex: number,
  response: string | string[] | number | null
) {
  if (!shouldShuffleQuestions(survey)) return getNextSurveyStep(survey, originalQuestionIndex, response)
  // Shuffled surveys cannot use branching and must advance through display order.
  // Non-shuffled surveys retain the configured/original-index branching semantics.
  return progress.questionIndex === progress.questionOrder.length - 1
    ? SurveyQuestionBranchingType.End
    : progress.questionIndex + 1
}

export function Questions({
  survey,
  client,
  surveyLanguage,
  appearance,
  styleOverrides,
  initialProgress,
  onProgressChange = () => true,
  onResponsesChange = () => {},
  onSubmit,
}: {
  survey: Survey
  client?: PostHog
  surveyLanguage?: string | null
  appearance: SurveyAppearanceTheme
  styleOverrides?: StyleProp<ViewStyle>
  initialProgress?: SurveyProgress
  onProgressChange?: (progress: SurveyProgress, completed: boolean) => boolean
  onResponsesChange?: (responses: SurveyResponses) => void
  onSubmit: () => void
}): JSX.Element {
  const [progress, setProgress] = useState(() => initialProgress ?? createSurveyProgress(survey))
  const completedRef = useRef(false)
  const progressRef = useRef(progress)
  const currentQuestionIndex = progress.questionIndex
  const surveyQuestions = useMemo(
    () =>
      progress.questionOrder.map((index) => ({
        ...survey.questions[index],
        originalQuestionIndex: index,
      })),
    [survey, progress.questionOrder]
  )
  const posthogFromHook = usePostHog()
  const posthog = client ?? posthogFromHook

  const onNextButtonClick = ({
    res,
    originalQuestionIndex,
    questionId,
  }: {
    res: string | string[] | number | null
    originalQuestionIndex: number
    questionId: string
  }): void => {
    if (completedRef.current || progressRef.current !== progress || !canCaptureSurvey(posthog)) return
    const responseKey = getSurveyResponseKey(questionId)
    const allResponses = { ...progress.responses, [responseKey]: res }
    const nextStep = nextQuestion(survey, progress, originalQuestionIndex, res)
    const completed = nextStep === SurveyQuestionBranchingType.End
    const nextProgress: SurveyProgress = {
      ...progress,
      responses: allResponses,
      questionIndex: completed ? currentQuestionIndex : nextStep,
      questionSnapshots: {
        ...progress.questionSnapshots,
        [questionId]: surveyQuestions[currentQuestionIndex].question,
      },
      surveyLanguage,
    }
    if (onProgressChange(nextProgress, completed) === false) return
    progressRef.current = nextProgress
    completedRef.current = completed
    setProgress(nextProgress)
    onResponsesChange(allResponses)
    if (survey.enable_partial_responses || completed) {
      sendSurveyEvent(allResponses, survey, posthog, surveyLanguage, nextProgress, completed)
    }
    if (completed) onSubmit()
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
