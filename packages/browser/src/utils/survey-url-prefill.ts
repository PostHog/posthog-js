import { Survey, SurveyQuestion, SurveyQuestionType } from '../posthog-surveys-types'
import { getSurveyResponseKey } from '../extensions/surveys/surveys-extension-utils'
import { logger } from './logger'

/**
 * Extracted URL prefill parameters by question index
 */
export interface PrefillParams {
    [questionIndex: number]: string[]
}

/**
 * Extract prefill parameters from URL search params
 * Format: ?q0=1&q1=8&q2=0&q2=2&auto_submit=true
 */
export function extractPrefillParamsFromUrl(searchParams: URLSearchParams): {
    params: PrefillParams
    autoSubmit: boolean
} {
    const params: PrefillParams = {}
    const autoSubmit = searchParams.get('auto_submit') === 'true'

    for (const [key, value] of searchParams.entries()) {
        const match = key.match(/^q(\d+)$/)
        if (match) {
            const questionIndex = parseInt(match[1], 10)
            if (!params[questionIndex]) {
                params[questionIndex] = []
            }
            params[questionIndex].push(value)
        }
    }

    return { params, autoSubmit }
}

/**
 * Convert URL prefill values to SDK response format
 */
export function convertPrefillToResponses(survey: Survey, prefillParams: PrefillParams): Record<string, any> {
    const responses: Record<string, any> = {}

    survey.questions.forEach((question: SurveyQuestion, index: number) => {
        if (!prefillParams[index] || !question.id) {
            return
        }

        const values = prefillParams[index]
        const responseKey = getSurveyResponseKey(question.id)

        try {
            switch (question.type) {
                case SurveyQuestionType.SingleChoice: {
                    if (!question.choices || question.choices.length === 0) {
                        logger.warn(`[Survey Prefill] Question ${index} has no choices`)
                        return
                    }
                    const choiceIndex = parseInt(values[0], 10)
                    if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= question.choices.length) {
                        logger.warn(`[Survey Prefill] Invalid choice index for q${index}: ${values[0]}`)
                        return
                    }
                    responses[responseKey] = question.choices[choiceIndex]
                    break
                }

                case SurveyQuestionType.MultipleChoice: {
                    if (!question.choices || question.choices.length === 0) {
                        logger.warn(`[Survey Prefill] Question ${index} has no choices`)
                        return
                    }
                    const choiceIndices = values
                        .map((v) => parseInt(v, 10))
                        .filter((i) => !isNaN(i) && i >= 0 && i < question.choices.length)

                    if (choiceIndices.length === 0) {
                        logger.warn(`[Survey Prefill] No valid choices for q${index}`)
                        return
                    }

                    // Remove duplicates and map to choice values
                    const uniqueChoices = [...new Set(choiceIndices.map((i) => question.choices[i]))]
                    responses[responseKey] = uniqueChoices
                    break
                }

                case SurveyQuestionType.Rating: {
                    const rating = parseInt(values[0], 10)
                    const scale = question.scale || 10

                    if (isNaN(rating) || rating < 0 || rating > scale) {
                        logger.warn(
                            `[Survey Prefill] Invalid rating for q${index}: ${values[0]} (scale: 0-${scale})`
                        )
                        return
                    }
                    responses[responseKey] = rating
                    break
                }

                default:
                    logger.info(`[Survey Prefill] Question type ${question.type} does not support prefill`)
            }
        } catch (error) {
            logger.error(`[Survey Prefill] Error converting q${index}:`, error)
        }
    })

    return responses
}

/**
 * Check if all REQUIRED questions are prefilled
 */
export function allRequiredQuestionsFilled(survey: Survey, responses: Record<string, any>): boolean {
    return survey.questions.every((question: SurveyQuestion) => {
        // Optional questions don't block auto-submit
        if (question.optional) {
            return true
        }

        // Link and open questions don't need prefill
        if (question.type === SurveyQuestionType.Link || question.type === SurveyQuestionType.Open) {
            return true
        }

        // Required question must have response
        if (!question.id) {
            return false
        }

        const responseKey = getSurveyResponseKey(question.id)
        return responses.hasOwnProperty(responseKey)
    })
}
