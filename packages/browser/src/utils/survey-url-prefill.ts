import { Survey, SurveyQuestion, SurveyQuestionType } from '../posthog-surveys-types'
import { getSurveyResponseKey } from '../extensions/surveys/surveys-extension-utils'
import { logger } from './logger'
import { isUndefined } from '@posthog/core'

/**
 * Extracted URL prefill parameters by question index
 */
export interface PrefillParams {
    [questionIndex: number]: string[]
}

/**
 * Extract prefill parameters from URL search string
 * Format: ?q0=1&q1=8&q2=0&q2=2&auto_submit=true
 * NOTE: Manual parsing for IE11/op_mini compatibility (no URLSearchParams)
 */
export function extractPrefillParamsFromUrl(searchString: string): {
    params: PrefillParams
    autoSubmit: boolean
} {
    const params: PrefillParams = {}
    let autoSubmit = false

    // Remove leading ? if present
    const cleanSearch = searchString.replace(/^\?/, '')
    if (!cleanSearch) {
        return { params, autoSubmit }
    }

    // Split by & to get key-value pairs
    const pairs = cleanSearch.split('&')

    for (const pair of pairs) {
        const [key, value] = pair.split('=')
        if (!key || isUndefined(value)) {
            continue
        }

        const decodedKey = decodeURIComponent(key)
        const decodedValue = decodeURIComponent(value)

        // Check for auto_submit parameter
        if (decodedKey === 'auto_submit' && decodedValue === 'true') {
            autoSubmit = true
            continue
        }

        // Check for question parameters (q0, q1, etc.)
        const match = decodedKey.match(/^q(\d+)$/)
        if (match) {
            const questionIndex = parseInt(match[1], 10)
            if (!params[questionIndex]) {
                params[questionIndex] = []
            }
            params[questionIndex].push(decodedValue)
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
                    if (uniqueChoices.length < choiceIndices.length) {
                        logger.warn(`[Survey Prefill] Removed duplicate choices for q${index}`)
                    }
                    responses[responseKey] = uniqueChoices
                    break
                }

                case SurveyQuestionType.Rating: {
                    const rating = parseInt(values[0], 10)
                    const scale = question.scale || 10

                    if (isNaN(rating) || rating < 0 || rating > scale) {
                        logger.warn(`[Survey Prefill] Invalid rating for q${index}: ${values[0]} (scale: 0-${scale})`)
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
 * Check if all REQUIRED questions that support prefill are filled
 */
export function allRequiredQuestionsFilled(survey: Survey, responses: Record<string, any>): boolean {
    return survey.questions.every((question: SurveyQuestion) => {
        // Optional questions don't block auto-submit
        if (question.optional) {
            return true
        }

        // Link and open questions don't support prefill currently, so they don't block auto-submit
        // If support is added in the future, they will be checked like other question types below
        if (question.type === SurveyQuestionType.Link || question.type === SurveyQuestionType.Open) {
            return true
        }

        // Required question must have a valid ID and response
        if (!question.id) {
            return false
        }

        const responseKey = getSurveyResponseKey(question.id)
        const hasResponse = responses.hasOwnProperty(responseKey)

        // For question types that support prefill, require a response
        return hasResponse
    })
}
