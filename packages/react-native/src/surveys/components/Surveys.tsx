import React, { useMemo, useRef, useState } from 'react'
import { ScrollView, StyleProp, ViewStyle } from 'react-native'

import { getDisplayOrderQuestions, getNextSurveyStep, SurveyAppearanceTheme } from '../surveys-utils'
import {
  Survey,
  SurveyAppearance,
  SurveyQuestion,
  maybeAdd,
  SurveyQuestionBranchingType,
  isUndefined,
  isNullish,
  uuidv7,
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

export type SurveyResponses = Record<string, string | number | string[] | null>

interface SendSurveyEventArgs {
  responses?: SurveyResponses
  survey: Survey
  posthog: PostHog
  surveySubmissionId: string
  isSurveyCompleted: boolean
}

export const sendSurveyEvent = ({
  responses = {},
  survey,
  posthog,
  surveySubmissionId,
  isSurveyCompleted,
}: SendSurveyEventArgs): void => {
  // map question ids also to the old format for back compatibility
  const oldFormatResponses: SurveyResponses = {}
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
    $survey_submission_id: surveySubmissionId,
    $survey_completed: isSurveyCompleted,
    ...allResponses,
    $set: {
      [getSurveyInteractionProperty(survey, 'responded')]: true,
    },
  })
}

/**
 * Checks if the responses object has any non-null values
 */
const surveyHasResponses = (responses: SurveyResponses | undefined): boolean => {
  return Object.values(responses || {}).filter((resp) => !isNullish(resp)).length > 0
}

interface DismissedSurveyEventArgs {
  survey: Survey
  posthog: PostHog
  responses?: SurveyResponses
  surveySubmissionId?: string
}

export const dismissedSurveyEvent = ({
  survey,
  posthog,
  responses,
  surveySubmissionId,
}: DismissedSurveyEventArgs): void => {
  // map question ids also to the old format for back compatibility
  const oldFormatResponses: SurveyResponses = {}
  if (responses) {
    survey.questions.forEach((question: SurveyQuestion) => {
      const oldResponseKey = getSurveyOldResponseKey(question.originalQuestionIndex)
      const response = getSurveyResponseValue(responses, question.id)
      if (!isUndefined(response)) {
        oldFormatResponses[oldResponseKey] = response
      }
    })
  }

  posthog.capture('survey dismissed', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    $survey_partially_completed: surveyHasResponses(responses),
    $survey_questions: survey.questions.map((question: SurveyQuestion) => ({
      id: question.id,
      question: question.question,
      response: getSurveyResponseValue(responses || {}, question.id),
    })),
    ...maybeAdd('$survey_submission_id', surveySubmissionId),
    ...responses,
    ...oldFormatResponses,
    $set: {
      [getSurveyInteractionProperty(survey, 'dismissed')]: true,
    },
  })
}

export interface QuestionsProps {
  survey: Survey
  appearance: SurveyAppearanceTheme
  styleOverrides?: StyleProp<ViewStyle>
  onSubmit: () => void
  /** Callback to share current responses with parent, called on each response change */
  onResponsesChange?: (responses: SurveyResponses, surveySubmissionId: string) => void
}

export function Questions({
  survey,
  appearance,
  styleOverrides,
  onSubmit,
  onResponsesChange,
}: QuestionsProps): JSX.Element {
  const [questionsResponses, setQuestionsResponses] = useState<SurveyResponses>({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const surveyQuestions = useMemo(() => getDisplayOrderQuestions(survey), [survey])
  const posthog = usePostHog()

  // Generate a unique submission ID for this survey session (persists across questions)
  const surveySubmissionIdRef = useRef<string>(uuidv7())
  const surveySubmissionId = surveySubmissionIdRef.current

  const onNextButtonClick = ({
    res,
    originalQuestionIndex,
    questionId,
  }: {
    res: string | string[] | number | null
    originalQuestionIndex: number
    questionId: string
  }): void => {
    const responseKey = getSurveyNewResponseKey(questionId)

    const allResponses: SurveyResponses = {
      ...questionsResponses,
      [responseKey]: res,
    }
    setQuestionsResponses(allResponses)

    // Notify parent of response changes (for partial response tracking)
    onResponsesChange?.(allResponses, surveySubmissionId)

    // Get the next question index based on conditional logic
    const nextStep = getNextSurveyStep(survey, originalQuestionIndex, res)
    const isSurveyCompleted = nextStep === SurveyQuestionBranchingType.End

    // Send event after each question if partial responses enabled, or only at the end
    if (survey.enable_partial_responses || isSurveyCompleted) {
      sendSurveyEvent({
        responses: allResponses,
        survey,
        posthog,
        surveySubmissionId,
        isSurveyCompleted,
      })
    }

    if (isSurveyCompleted) {
      // End the survey
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
