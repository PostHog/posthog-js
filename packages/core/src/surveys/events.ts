import { SurveyWithIteration } from './keys'
import { SurveyResponses, SurveyResponseValue } from '../types'
import { isArray, isNullish, isUndefined } from '../utils'

export const SURVEY_LANGUAGE_PROPERTY = '$survey_language'

export function getSurveyResponseKey(questionId: string): string {
  return `$survey_response_${questionId}`
}

export function getSurveyOldResponseKey(originalQuestionIndex: number): string {
  return originalQuestionIndex === 0 ? '$survey_response' : `$survey_response_${originalQuestionIndex}`
}

export function getSurveyResponseValue(
  responses: SurveyResponses,
  questionId?: string
): SurveyResponseValue | undefined {
  if (!questionId) {
    return null
  }
  const response = responses[getSurveyResponseKey(questionId)]
  if (isArray(response)) {
    return [...response]
  }
  return response
}

export function buildSurveyResponseProperties(
  responses: SurveyResponses = {},
  survey: SurveyForResponses,
  questionSnapshots?: Record<string, string>
): Record<string, unknown> {
  const oldFormatResponses: SurveyResponses = {}
  survey.questions.forEach((question: SurveyQuestionForResponses) => {
    if (isUndefined(question.originalQuestionIndex)) {
      return
    }
    const oldResponseKey = getSurveyOldResponseKey(question.originalQuestionIndex)
    const response = getSurveyResponseValue(responses, question.id)
    if (!isUndefined(response)) {
      oldFormatResponses[oldResponseKey] = response
    }
  })

  return {
    $survey_questions: survey.questions.map((question: SurveyQuestionForResponses) => ({
      id: question.id,
      question: questionSnapshots?.[question.id ?? ''] ?? question.question,
      response: getSurveyResponseValue(responses, question.id),
    })),
    ...responses,
    ...oldFormatResponses,
  }
}

export function recordSurveyAnswer(
  { responses, questionSnapshots = {} }: { responses: SurveyResponses; questionSnapshots?: Record<string, string> },
  questionId: string,
  response: SurveyResponseValue,
  question?: SurveyQuestionForResponses
): { responses: SurveyResponses; questionSnapshots: Record<string, string> } {
  // Snapshot the question text as it appeared to the user right now, so that
  // $survey_questions[].question in sent/dismissed events reflects the language
  // the user saw when they answered, not the language active at event-fire time.
  return {
    responses: { ...responses, [getSurveyResponseKey(questionId)]: response },
    questionSnapshots: question?.id ? { ...questionSnapshots, [question.id]: question.question } : questionSnapshots,
  }
}

export function buildSurveyResponseEventProperties({
  event,
  survey,
  responses = {},
  submissionId,
  completed,
  surveyLanguage,
  questionSnapshots,
}: {
  event: 'sent' | 'dismissed' | 'abandoned'
  survey: SurveyForResponses
  responses?: SurveyResponses
  submissionId?: string
  completed?: boolean
  surveyLanguage?: string | null
  questionSnapshots?: Record<string, string>
}): Record<string, unknown> {
  return {
    ...(!isUndefined(submissionId) && { $survey_submission_id: submissionId }),
    ...(event === 'sent'
      ? !isUndefined(completed) && { $survey_completed: completed }
      : { $survey_partially_completed: surveyHasResponses(responses) }),
    ...(surveyLanguage && { [SURVEY_LANGUAGE_PROPERTY]: surveyLanguage }),
    ...buildSurveyResponseProperties(responses, survey, questionSnapshots),
  }
}

export function surveyHasResponses(responses: SurveyResponses = {}): boolean {
  return Object.values(responses).some((response) => !isNullish(response))
}

export function getSurveyInteractionProperty(survey: SurveyWithIteration, action: string): string {
  let surveyProperty = `$survey_${action}/${survey.id}`
  if (survey.current_iteration && survey.current_iteration > 0) {
    surveyProperty = `$survey_${action}/${survey.id}/${survey.current_iteration}`
  }

  return surveyProperty
}
type SurveyQuestionForResponses = {
  id?: string
  question: string
  originalQuestionIndex?: number
}

type SurveyForResponses = {
  questions: SurveyQuestionForResponses[]
}
