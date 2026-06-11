import { Survey, SurveyQuestion, SurveyQuestionBranchingType, SurveyQuestionType } from '../posthog-surveys-types'
import { getSurveyResponseKey } from '../extensions/surveys/surveys-extension-utils'
import { logger } from './logger'
import { isUndefined } from '@posthog/core'
import { getNextSurveyStep } from './survey-branching'

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
 * Calculate which question index to start at based on prefilled questions.
 * Advances past consecutive prefilled questions (starting from index 0)
 * that have skipSubmitButton enabled, respecting any branching logic configured
 * on those questions.
 *
 * @param survey - The full survey object (needed for branching logic)
 * @param prefilledIndices - Array of question indices that have been prefilled
 * @param responses - Map of response keys to response values
 * @returns Object with startQuestionIndex and map of questions which have been skipped
 */
export function calculatePrefillStartIndex(
    survey: Survey,
    prefilledIndices: number[],
    responses: Record<string, any>
): { startQuestionIndex: number; skippedResponses: Record<string, any> } {
    let currentIndex = 0
    const skippedResponses: Record<string, any> = {}

    const MAX_ITERATIONS = survey.questions.length + 1
    const iterations = 0
    while (currentIndex < survey.questions.length && iterations < MAX_ITERATIONS) {
        // Stop if current question is not prefilled
        if (!prefilledIndices.includes(currentIndex)) {
            break
        }

        const question = survey.questions[currentIndex]

        // Only advance if the prefilled question has skipSubmitButton
        if (!question || !('skipSubmitButton' in question) || !question.skipSubmitButton) {
            // Show question if skipSubmitButton is false, even if prefilled
            break
        }

        // Record the skipped response
        if (question.id) {
            const responseKey = getSurveyResponseKey(question.id)
            if (!isUndefined(responses[responseKey])) {
                skippedResponses[responseKey] = responses[responseKey]
            }
        }

        // Use branching logic to determine the next question
        const response = question.id ? responses[getSurveyResponseKey(question.id)] : null
        const nextStep = getNextSurveyStep(survey, currentIndex, response)

        if (nextStep === SurveyQuestionBranchingType.End) {
            // Survey is complete - return questions.length to indicate completion
            return { startQuestionIndex: survey.questions.length, skippedResponses }
        }

        // Move to the next question (respecting branching)
        currentIndex = nextStep
    }

    return { startQuestionIndex: currentIndex, skippedResponses }
}
