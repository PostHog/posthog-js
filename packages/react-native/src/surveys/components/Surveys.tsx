import React, { useMemo, useState } from 'react'
import { ScrollView, StyleProp, ViewStyle } from 'react-native'

import { getDisplayOrderQuestions, SurveyAppearanceTheme } from '../surveys-utils'
import { Survey, SurveyAppearance, SurveyQuestion, maybeAdd } from '../../../../posthog-core/src'
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

export const sendSurveyEvent = (
  responses: Record<string, string | number | string[] | null> = {},
  survey: Survey,
  posthog: PostHog
): void => {
  posthog.capture('survey sent', {
    $survey_name: survey.name,
    $survey_id: survey.id,
    ...maybeAdd('$survey_iteration', survey.current_iteration),
    ...maybeAdd('$survey_iteration_start_date', survey.current_iteration_start_date),
    $survey_questions: survey.questions.map((question: SurveyQuestion) => question.question),
    ...responses,
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
  }: // displayQuestionIndex,
  {
    res: string | string[] | number | null
    originalQuestionIndex: number
    // displayQuestionIndex: number
  }): void => {
    const responseKey = originalQuestionIndex === 0 ? `$survey_response` : `$survey_response_${originalQuestionIndex}`

    setQuestionsResponses({ ...questionsResponses, [responseKey]: res })

    const isLastDisplayedQuestion = originalQuestionIndex === survey.questions.length - 1
    if (isLastDisplayedQuestion) {
      sendSurveyEvent({ ...questionsResponses, [responseKey]: res }, survey, posthog)
      onSubmit()
    } else {
      setCurrentQuestionIndex(originalQuestionIndex + 1)
    }
  }

  const question = surveyQuestions[currentQuestionIndex]

  return (
    <ScrollView style={[styleOverrides, { flexGrow: 0 }]}>
      {getQuestionComponent({
        question,
        appearance,
        onSubmit: (res) =>
          onNextButtonClick({
            res,
            originalQuestionIndex: question.originalQuestionIndex,
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
