import { MultipleSurveyQuestion, Survey, SurveyQuestion } from '@posthog/core'

const hasBranching = (survey: Survey): boolean => survey.questions.some((question) => !!question.branching?.type)

export const shouldShuffleQuestions = (survey: Survey): boolean => {
  const partialResponsesEnabled = survey.enable_partial_responses

  return !!survey.appearance?.shuffleQuestions && !partialResponsesEnabled && !hasBranching(survey)
}

/**
 * Fisher-Yates shuffle without mutating the input array.
 */
export const shuffle = <T>(array: readonly T[]): T[] => {
  const shuffled = [...array]

  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }

  return shuffled
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

export const getDisplayOrderChoices = (question: MultipleSurveyQuestion): string[] => {
  if (!question.shuffleOptions) {
    return question.choices
  }

  const choices = [...question.choices]
  const openEndedChoice = question.hasOpenChoice ? choices.pop() : undefined
  const shuffledChoices = reverseIfUnshuffled(choices, shuffle(choices))

  if (openEndedChoice !== undefined) {
    shuffledChoices.push(openEndedChoice)
  }

  return shuffledChoices
}
