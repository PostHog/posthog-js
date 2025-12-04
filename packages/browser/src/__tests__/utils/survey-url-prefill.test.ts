import {
    extractPrefillParamsFromUrl,
    convertPrefillToResponses,
    calculatePrefillStartIndex,
    PrefillParams,
} from '../../utils/survey-url-prefill'
import { Survey, SurveyQuestion, SurveyQuestionType, SurveyType } from '../../posthog-surveys-types'

describe('extractPrefillParamsFromUrl', () => {
    describe('empty and invalid inputs', () => {
        it('should return empty params for empty string', () => {
            const result = extractPrefillParamsFromUrl('')
            expect(result.params).toEqual({})
            expect(result.autoSubmit).toBe(false)
        })

        it('should return empty params for just question mark', () => {
            const result = extractPrefillParamsFromUrl('?')
            expect(result.params).toEqual({})
            expect(result.autoSubmit).toBe(false)
        })

        it('should handle string without leading question mark', () => {
            const result = extractPrefillParamsFromUrl('q0=1&q1=2')
            expect(result.params).toEqual({
                0: ['1'],
                1: ['2'],
            })
        })

        it('should handle string with leading question mark', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&q1=2')
            expect(result.params).toEqual({
                0: ['1'],
                1: ['2'],
            })
        })
    })

    describe('single question parameters', () => {
        it('should parse single question parameter', () => {
            const result = extractPrefillParamsFromUrl('?q0=1')
            expect(result.params).toEqual({
                0: ['1'],
            })
        })

        it('should parse multiple different questions', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&q1=5&q2=3')
            expect(result.params).toEqual({
                0: ['1'],
                1: ['5'],
                2: ['3'],
            })
        })

        it('should handle question indices with multiple digits', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&q15=2&q100=3')
            expect(result.params).toEqual({
                0: ['1'],
                15: ['2'],
                100: ['3'],
            })
        })
    })

    describe('multiple values for same question', () => {
        it('should collect multiple values for same question index', () => {
            const result = extractPrefillParamsFromUrl('?q2=0&q2=2&q2=4')
            expect(result.params).toEqual({
                2: ['0', '2', '4'],
            })
        })

        it('should handle mix of single and multiple value questions', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&q1=5&q2=0&q2=2')
            expect(result.params).toEqual({
                0: ['1'],
                1: ['5'],
                2: ['0', '2'],
            })
        })
    })

    describe('URL encoding', () => {
        it('should decode URL-encoded question values', () => {
            const result = extractPrefillParamsFromUrl('?q0=Hello%20World&q1=Test%2FValue')
            expect(result.params).toEqual({
                0: ['Hello World'],
                1: ['Test/Value'],
            })
        })

        it('should decode special characters', () => {
            const result = extractPrefillParamsFromUrl('?q0=%26%3D%3F')
            expect(result.params).toEqual({
                0: ['&=?'],
            })
        })
    })

    describe('auto_submit parameter', () => {
        it('should detect auto_submit=true', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&auto_submit=true')
            expect(result.autoSubmit).toBe(true)
        })

        it('should not set autoSubmit for auto_submit=false', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&auto_submit=false')
            expect(result.autoSubmit).toBe(false)
        })

        it('should not set autoSubmit for other auto_submit values', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&auto_submit=1')
            expect(result.autoSubmit).toBe(false)
        })

        it('should handle auto_submit parameter in any position', () => {
            const result = extractPrefillParamsFromUrl('?auto_submit=true&q0=1&q1=2')
            expect(result.autoSubmit).toBe(true)
            expect(result.params).toEqual({
                0: ['1'],
                1: ['2'],
            })
        })
    })

    describe('invalid parameters', () => {
        it('should ignore parameters without values', () => {
            const result = extractPrefillParamsFromUrl('?q0&q1=1')
            expect(result.params).toEqual({
                1: ['1'],
            })
        })

        it('should ignore non-question parameters', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&foo=bar&q1=2')
            expect(result.params).toEqual({
                0: ['1'],
                1: ['2'],
            })
        })

        it('should ignore malformed question parameters', () => {
            const result = extractPrefillParamsFromUrl('?q=1&qa=2&q0=3')
            expect(result.params).toEqual({
                0: ['3'],
            })
        })

        it('should handle empty parameter values', () => {
            const result = extractPrefillParamsFromUrl('?q0=&q1=1')
            expect(result.params).toEqual({
                0: [''],
                1: ['1'],
            })
        })
    })

    describe('edge cases', () => {
        it('should handle parameters with no equals sign', () => {
            const result = extractPrefillParamsFromUrl('?q0=1&invalidparam&q1=2')
            expect(result.params).toEqual({
                0: ['1'],
                1: ['2'],
            })
        })

        it('should handle multiple equals signs in value', () => {
            // Note: split('=') only splits on first '=', so 'q0=a=b=c' becomes key='q0', value='a'
            // This is the actual behavior of the implementation
            const result = extractPrefillParamsFromUrl('?q0=a=b=c')
            expect(result.params).toEqual({
                0: ['a'], // Only 'a' is captured, not 'a=b=c'
            })
        })

        it('should handle duplicate auto_submit parameters', () => {
            const result = extractPrefillParamsFromUrl('?auto_submit=true&q0=1&auto_submit=false')
            expect(result.autoSubmit).toBe(true) // First true wins
        })
    })
})

describe('convertPrefillToResponses', () => {
    const baseSurvey: Survey = {
        id: 'test-survey',
        name: 'Test Survey',
        description: 'Test Description',
        type: SurveyType.Popover,
        questions: [],
        appearance: null,
        conditions: null,
        start_date: null,
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
        feature_flag_keys: null,
        linked_flag_key: null,
        targeting_flag_key: null,
        internal_targeting_flag_key: null,
    }

    describe('single choice questions', () => {
        const singleChoiceQuestion: SurveyQuestion = {
            type: SurveyQuestionType.SingleChoice,
            id: 'question-1',
            question: 'Choose one',
            choices: ['Option A', 'Option B', 'Option C'],
        }

        it('should convert valid single choice index', () => {
            const survey = { ...baseSurvey, questions: [singleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['1'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-1': 'Option B',
            })
        })

        it('should handle index 0', () => {
            const survey = { ...baseSurvey, questions: [singleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['0'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-1': 'Option A',
            })
        })

        it('should handle last valid index', () => {
            const survey = { ...baseSurvey, questions: [singleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['2'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-1': 'Option C',
            })
        })

        it('should ignore out-of-bounds index', () => {
            const survey = { ...baseSurvey, questions: [singleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['999'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should ignore negative index', () => {
            const survey = { ...baseSurvey, questions: [singleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['-1'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should ignore non-numeric index', () => {
            const survey = { ...baseSurvey, questions: [singleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['invalid'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should ignore when question has no choices', () => {
            const questionWithoutChoices = { ...singleChoiceQuestion, choices: undefined }
            const survey = { ...baseSurvey, questions: [questionWithoutChoices] }
            const prefillParams: PrefillParams = { 0: ['0'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should ignore when question has empty choices array', () => {
            const questionWithEmptyChoices = { ...singleChoiceQuestion, choices: [] }
            const survey = { ...baseSurvey, questions: [questionWithEmptyChoices] }
            const prefillParams: PrefillParams = { 0: ['0'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should use only first value for single choice', () => {
            const survey = { ...baseSurvey, questions: [singleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['1', '2'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-1': 'Option B',
            })
        })
    })

    describe('multiple choice questions', () => {
        const multipleChoiceQuestion: SurveyQuestion = {
            type: SurveyQuestionType.MultipleChoice,
            id: 'question-2',
            question: 'Choose multiple',
            choices: ['Option A', 'Option B', 'Option C', 'Option D'],
        }

        it('should convert valid multiple choice indices', () => {
            const survey = { ...baseSurvey, questions: [multipleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['0', '2', '3'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-2': ['Option A', 'Option C', 'Option D'],
            })
        })

        it('should handle single selection', () => {
            const survey = { ...baseSurvey, questions: [multipleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['1'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-2': ['Option B'],
            })
        })

        it('should filter out invalid indices', () => {
            const survey = { ...baseSurvey, questions: [multipleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['0', '999', '2', '-1'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-2': ['Option A', 'Option C'],
            })
        })

        it('should remove duplicate indices', () => {
            const survey = { ...baseSurvey, questions: [multipleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['0', '1', '0', '1', '2'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-2': ['Option A', 'Option B', 'Option C'],
            })
        })

        it('should ignore when all indices are invalid', () => {
            const survey = { ...baseSurvey, questions: [multipleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['999', 'invalid', '-1'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should ignore when question has no choices', () => {
            const questionWithoutChoices = { ...multipleChoiceQuestion, choices: undefined }
            const survey = { ...baseSurvey, questions: [questionWithoutChoices] }
            const prefillParams: PrefillParams = { 0: ['0', '1'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should handle all choices selected', () => {
            const survey = { ...baseSurvey, questions: [multipleChoiceQuestion] }
            const prefillParams: PrefillParams = { 0: ['0', '1', '2', '3'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-2': ['Option A', 'Option B', 'Option C', 'Option D'],
            })
        })
    })

    describe('rating questions', () => {
        const ratingQuestion: SurveyQuestion = {
            type: SurveyQuestionType.Rating,
            id: 'question-3',
            question: 'Rate us',
            scale: 10,
            display: 'number',
            lowerBoundLabel: 'Not likely',
            upperBoundLabel: 'Very likely',
        }

        it('should convert valid rating within scale', () => {
            const survey = { ...baseSurvey, questions: [ratingQuestion] }
            const prefillParams: PrefillParams = { 0: ['7'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-3': 7,
            })
        })

        it('should handle rating of 0', () => {
            const survey = { ...baseSurvey, questions: [ratingQuestion] }
            const prefillParams: PrefillParams = { 0: ['0'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-3': 0,
            })
        })

        it('should handle rating at max scale', () => {
            const survey = { ...baseSurvey, questions: [ratingQuestion] }
            const prefillParams: PrefillParams = { 0: ['10'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-3': 10,
            })
        })

        it('should ignore rating above scale', () => {
            const survey = { ...baseSurvey, questions: [ratingQuestion] }
            const prefillParams: PrefillParams = { 0: ['11'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should ignore negative rating', () => {
            const survey = { ...baseSurvey, questions: [ratingQuestion] }
            const prefillParams: PrefillParams = { 0: ['-1'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should ignore non-numeric rating', () => {
            const survey = { ...baseSurvey, questions: [ratingQuestion] }
            const prefillParams: PrefillParams = { 0: ['invalid'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should handle custom scale', () => {
            const customRatingQuestion: SurveyQuestion = {
                ...ratingQuestion,
                scale: 5 as const,
            }
            const survey = { ...baseSurvey, questions: [customRatingQuestion] }
            const prefillParams: PrefillParams = { 0: ['5'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-3': 5,
            })
        })

        it('should reject rating above custom scale', () => {
            const customRatingQuestion: SurveyQuestion = {
                ...ratingQuestion,
                scale: 5 as const,
            }
            const survey = { ...baseSurvey, questions: [customRatingQuestion] }
            const prefillParams: PrefillParams = { 0: ['6'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should default to scale of 10 when not specified', () => {
            const ratingWithoutScale = { ...ratingQuestion, scale: undefined }
            const survey = { ...baseSurvey, questions: [ratingWithoutScale] }
            const prefillParams: PrefillParams = { 0: ['10'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                '$survey_response_question-3': 10,
            })
        })
    })

    describe('unsupported question types', () => {
        it('should skip open text questions', () => {
            const openQuestion: SurveyQuestion = {
                type: SurveyQuestionType.Open,
                id: 'question-4',
                question: 'Tell us more',
            }
            const survey = { ...baseSurvey, questions: [openQuestion] }
            const prefillParams: PrefillParams = { 0: ['Some text'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should skip link questions', () => {
            const linkQuestion: SurveyQuestion = {
                type: SurveyQuestionType.Link,
                id: 'question-5',
                question: 'Click here',
                link: 'https://example.com',
            }
            const survey = { ...baseSurvey, questions: [linkQuestion] }
            const prefillParams: PrefillParams = { 0: ['ignored'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })
    })

    describe('multiple questions', () => {
        it('should handle multiple different question types', () => {
            const questions: SurveyQuestion[] = [
                {
                    type: SurveyQuestionType.SingleChoice,
                    id: 'q1',
                    question: 'Q1',
                    choices: ['A', 'B', 'C'],
                },
                {
                    type: SurveyQuestionType.Rating,
                    id: 'q2',
                    question: 'Q2',
                    scale: 10,
                    display: 'number',
                    lowerBoundLabel: 'Low',
                    upperBoundLabel: 'High',
                },
                {
                    type: SurveyQuestionType.MultipleChoice,
                    id: 'q3',
                    question: 'Q3',
                    choices: ['X', 'Y', 'Z'],
                },
            ]
            const survey = { ...baseSurvey, questions }
            const prefillParams: PrefillParams = {
                0: ['1'],
                1: ['8'],
                2: ['0', '2'],
            }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                $survey_response_q1: 'B',
                $survey_response_q2: 8,
                $survey_response_q3: ['X', 'Z'],
            })
        })

        it('should skip questions without prefill params', () => {
            const questions: SurveyQuestion[] = [
                {
                    type: SurveyQuestionType.SingleChoice,
                    id: 'q1',
                    question: 'Q1',
                    choices: ['A', 'B'],
                },
                {
                    type: SurveyQuestionType.Rating,
                    id: 'q2',
                    question: 'Q2',
                    scale: 10,
                    display: 'number',
                    lowerBoundLabel: 'Low',
                    upperBoundLabel: 'High',
                },
            ]
            const survey = { ...baseSurvey, questions }
            const prefillParams: PrefillParams = { 1: ['5'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                $survey_response_q2: 5,
            })
        })

        it('should handle some valid and some invalid responses', () => {
            const questions: SurveyQuestion[] = [
                {
                    type: SurveyQuestionType.SingleChoice,
                    id: 'q1',
                    question: 'Q1',
                    choices: ['A', 'B'],
                },
                {
                    type: SurveyQuestionType.Rating,
                    id: 'q2',
                    question: 'Q2',
                    scale: 5,
                    display: 'number',
                    lowerBoundLabel: 'Low',
                    upperBoundLabel: 'High',
                },
            ]
            const survey = { ...baseSurvey, questions }
            const prefillParams: PrefillParams = {
                0: ['999'], // Invalid
                1: ['3'], // Valid
            }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                $survey_response_q2: 3,
            })
        })
    })

    describe('edge cases', () => {
        it('should skip questions without IDs', () => {
            const questionWithoutId: SurveyQuestion = {
                type: SurveyQuestionType.SingleChoice,
                question: 'No ID',
                choices: ['A', 'B'],
            }
            const survey = { ...baseSurvey, questions: [questionWithoutId] }
            const prefillParams: PrefillParams = { 0: ['0'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should handle empty prefillParams', () => {
            const questions: SurveyQuestion[] = [
                {
                    type: SurveyQuestionType.SingleChoice,
                    id: 'q1',
                    question: 'Q1',
                    choices: ['A', 'B'],
                },
            ]
            const survey = { ...baseSurvey, questions }
            const prefillParams: PrefillParams = {}

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should handle survey with no questions', () => {
            const survey = { ...baseSurvey, questions: [] }
            const prefillParams: PrefillParams = { 0: ['1'] }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({})
        })

        it('should handle prefill params with indices beyond question count', () => {
            const questions: SurveyQuestion[] = [
                {
                    type: SurveyQuestionType.SingleChoice,
                    id: 'q1',
                    question: 'Q1',
                    choices: ['A', 'B'],
                },
            ]
            const survey = { ...baseSurvey, questions }
            const prefillParams: PrefillParams = {
                0: ['0'],
                99: ['1'], // No question at index 99
            }

            const result = convertPrefillToResponses(survey, prefillParams)
            expect(result).toEqual({
                $survey_response_q1: 'A',
            })
        })
    })
})

describe('calculatePrefillStartIndex', () => {
    const ratingQuestionWithSkip: SurveyQuestion = {
        type: SurveyQuestionType.Rating,
        id: 'q-rating',
        question: 'Rate us',
        scale: 10,
        display: 'number',
        lowerBoundLabel: 'Low',
        upperBoundLabel: 'High',
        skipSubmitButton: true,
    }

    const ratingQuestionWithoutSkip: SurveyQuestion = {
        type: SurveyQuestionType.Rating,
        id: 'q-rating-no-skip',
        question: 'Rate us',
        scale: 10,
        display: 'number',
        lowerBoundLabel: 'Low',
        upperBoundLabel: 'High',
        skipSubmitButton: false,
    }

    const singleChoiceWithSkip: SurveyQuestion = {
        type: SurveyQuestionType.SingleChoice,
        id: 'q-single',
        question: 'Choose one',
        choices: ['A', 'B', 'C'],
        skipSubmitButton: true,
    }

    const openQuestion: SurveyQuestion = {
        type: SurveyQuestionType.Open,
        id: 'q-open',
        question: 'Tell us more',
    }

    describe('non-consecutive prefill', () => {
        it('should return 0 when only q1 is prefilled (q0 not prefilled)', () => {
            const questions = [ratingQuestionWithSkip, ratingQuestionWithSkip, openQuestion]
            const prefilledIndices = [1]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(0)
        })

        it('should return 0 when only q2 is prefilled', () => {
            const questions = [ratingQuestionWithSkip, ratingQuestionWithSkip, openQuestion]
            const prefilledIndices = [2]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(0)
        })
    })

    describe('consecutive prefill with skipSubmitButton', () => {
        it('should return 1 when q0 is prefilled with skipSubmitButton', () => {
            const questions = [ratingQuestionWithSkip, openQuestion]
            const prefilledIndices = [0]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(1)
        })

        it('should return 2 when q0 and q1 are prefilled with skipSubmitButton', () => {
            const questions = [ratingQuestionWithSkip, singleChoiceWithSkip, openQuestion]
            const prefilledIndices = [0, 1]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(2)
        })

        it('should return 3 (questions.length) when all questions are prefilled with skipSubmitButton', () => {
            const questions = [ratingQuestionWithSkip, singleChoiceWithSkip, ratingQuestionWithSkip]
            const prefilledIndices = [0, 1, 2]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(3)
        })
    })

    describe('consecutive prefill without skipSubmitButton', () => {
        it('should return 0 when q0 is prefilled but has no skipSubmitButton', () => {
            const questions = [ratingQuestionWithoutSkip, openQuestion]
            const prefilledIndices = [0]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(0)
        })

        it('should return 1 when q0 has skipSubmitButton but q1 does not', () => {
            const questions = [ratingQuestionWithSkip, ratingQuestionWithoutSkip, openQuestion]
            const prefilledIndices = [0, 1]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(1)
        })
    })

    describe('gap in prefill sequence', () => {
        it('should return 1 when q0 and q2 are prefilled but q1 is not', () => {
            const questions = [ratingQuestionWithSkip, ratingQuestionWithSkip, ratingQuestionWithSkip]
            const prefilledIndices = [0, 2]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(1)
        })

        it('should return 2 when q0, q1, q3 are prefilled but q2 is not', () => {
            const questions = [
                ratingQuestionWithSkip,
                singleChoiceWithSkip,
                ratingQuestionWithSkip,
                ratingQuestionWithSkip,
            ]
            const prefilledIndices = [0, 1, 3]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(2)
        })
    })

    describe('edge cases', () => {
        it('should return 0 for empty questions array', () => {
            expect(calculatePrefillStartIndex([], [0, 1])).toBe(0)
        })

        it('should return 0 for empty prefilled indices', () => {
            const questions = [ratingQuestionWithSkip, openQuestion]

            expect(calculatePrefillStartIndex(questions, [])).toBe(0)
        })

        it('should return 0 when prefilled indices are all beyond question count', () => {
            const questions = [ratingQuestionWithSkip]

            expect(calculatePrefillStartIndex(questions, [5, 10])).toBe(0)
        })

        it('should handle unsorted prefilled indices', () => {
            const questions = [ratingQuestionWithSkip, singleChoiceWithSkip, openQuestion]
            const prefilledIndices = [1, 0]

            expect(calculatePrefillStartIndex(questions, prefilledIndices)).toBe(2)
        })
    })
})
