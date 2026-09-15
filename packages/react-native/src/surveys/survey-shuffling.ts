import { shuffle } from '@posthog/core/surveys'
export { getDisplayOrderChoices, shuffle } from '@posthog/core/surveys'
import { Survey, SurveyQuestion } from '@posthog/core'

type SurveyWithPartialResponses = Survey & {
  enable_partial_responses?: boolean | null
}

const hasBranching = (survey: Survey): boolean => survey.questions.some((question) => !!question.branching?.type)

export const shouldShuffleQuestions = (survey: Survey): boolean => {
  const partialResponsesEnabled = (survey as SurveyWithPartialResponses).enable_partial_responses

  return !!survey.appearance?.shuffleQuestions && !partialResponsesEnabled && !hasBranching(survey)
}

const reverseIfUnshuffled = <T>(unshuffled: readonly T[], shuffled: T[]): T[] => {
  if (shuffled.length > 1 && unshuffled.every((value, index) => value === shuffled[index])) {
    return shuffled.reverse()
  }

  return shuffled
}

export const getDisplayOrderQuestions = (survey: Survey): SurveyQuestion[] => {
  const questions = survey.questions.map((question, originalQuestionIndex) => ({
    ...question,
    originalQuestionIndex,
  }))

  if (!shouldShuffleQuestions(survey)) {
    return questions
  }

  return reverseIfUnshuffled(questions, shuffle(questions))
}
