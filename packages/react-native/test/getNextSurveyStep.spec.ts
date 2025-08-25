import { getNextSurveyStep } from '../src/surveys/surveys-utils'
import { Survey, SurveyQuestionBranchingType, SurveyQuestionType, SurveyType } from '@posthog/core'

describe('getNextSurveyStep', () => {
  const createBasicSurvey = (questions: any[]): Survey => ({
    id: 'test-survey',
    name: 'Test Survey',
    type: SurveyType.Popover,
    questions,
    conditions: {},
    appearance: {},
    start_date: undefined,
    end_date: undefined,
    current_iteration: undefined,
    current_iteration_start_date: undefined,
  })

  describe('No branching logic', () => {
    it('should move to next question when no branching is defined', () => {
      const survey = createBasicSurvey([
        { type: SurveyQuestionType.Open, question: 'Question 1' },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
      ])

      const result = getNextSurveyStep(survey, 0, 'some response')
      expect(result).toBe(1)
    })

    it('should end survey when on last question with no branching', () => {
      const survey = createBasicSurvey([{ type: SurveyQuestionType.Open, question: 'Question 1' }])

      const result = getNextSurveyStep(survey, 0, 'some response')
      expect(result).toBe(SurveyQuestionBranchingType.End)
    })
  })

  describe('End branching', () => {
    it('should end survey when branching type is End', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Open,
          question: 'Question 1',
          branching: { type: SurveyQuestionBranchingType.End },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
      ])

      const result = getNextSurveyStep(survey, 0, 'some response')
      expect(result).toBe(SurveyQuestionBranchingType.End)
    })
  })

  describe('Specific question branching', () => {
    it('should jump to specific question when branching type is SpecificQuestion', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Open,
          question: 'Question 1',
          branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 2 },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      const result = getNextSurveyStep(survey, 0, 'some response')
      expect(result).toBe(2)
    })
  })

  describe('Response-based branching - Single Choice', () => {
    it('should branch based on single choice response', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.SingleChoice,
          question: 'Choose one',
          choices: ['Option A', 'Option B', 'Option C'],
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              0: 2, // Option A -> Question 3
              1: SurveyQuestionBranchingType.End, // Option B -> End
              2: 1, // Option C -> Question 2
            },
          },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      // Test Option A
      let result = getNextSurveyStep(survey, 0, 'Option A')
      expect(result).toBe(2)

      // Test Option B
      result = getNextSurveyStep(survey, 0, 'Option B')
      expect(result).toBe(SurveyQuestionBranchingType.End)

      // Test Option C
      result = getNextSurveyStep(survey, 0, 'Option C')
      expect(result).toBe(1)
    })

    it('should handle open choice in single choice questions', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.SingleChoice,
          question: 'Choose one',
          choices: ['Option A', 'Option B'],
          hasOpenChoice: true,
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              0: 1, // Option A -> Question 2
              1: 2, // Open choice -> Question 3
            },
          },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      // Test open choice response (not in predefined choices)
      const result = getNextSurveyStep(survey, 0, 'Custom response')
      expect(result).toBe(2)
    })

    it('should fall back to next question if no matching response value', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.SingleChoice,
          question: 'Choose one',
          choices: ['Option A', 'Option B'],
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              0: 2, // Only Option A has branching
            },
          },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      // Test Option B (no branching defined)
      const result = getNextSurveyStep(survey, 0, 'Option B')
      expect(result).toBe(1) // Should go to next question
    })
  })

  describe('Response-based branching - Rating', () => {
    it('should branch based on rating response (scale 5)', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Rating,
          question: 'Rate this',
          scale: 5,
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              negative: SurveyQuestionBranchingType.End, // 1-2 -> End
              neutral: 1, // 3 -> Question 2
              positive: 2, // 4-5 -> Question 3
            },
          },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      // Test negative rating
      let result = getNextSurveyStep(survey, 0, 1)
      expect(result).toBe(SurveyQuestionBranchingType.End)

      result = getNextSurveyStep(survey, 0, 2)
      expect(result).toBe(SurveyQuestionBranchingType.End)

      // Test neutral rating
      result = getNextSurveyStep(survey, 0, 3)
      expect(result).toBe(1)

      // Test positive rating
      result = getNextSurveyStep(survey, 0, 4)
      expect(result).toBe(2)

      result = getNextSurveyStep(survey, 0, 5)
      expect(result).toBe(2)
    })

    it('should branch based on rating response (scale 10 - NPS)', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Rating,
          question: 'Rate this',
          scale: 10,
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              detractors: 1, // 0-6 -> Question 2
              passives: 2, // 7-8 -> Question 3
              promoters: SurveyQuestionBranchingType.End, // 9-10 -> End
            },
          },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      // Test detractors
      let result = getNextSurveyStep(survey, 0, 0)
      expect(result).toBe(1)

      result = getNextSurveyStep(survey, 0, 6)
      expect(result).toBe(1)

      // Test passives
      result = getNextSurveyStep(survey, 0, 7)
      expect(result).toBe(2)

      result = getNextSurveyStep(survey, 0, 8)
      expect(result).toBe(2)

      // Test promoters
      result = getNextSurveyStep(survey, 0, 9)
      expect(result).toBe(SurveyQuestionBranchingType.End)

      result = getNextSurveyStep(survey, 0, 10)
      expect(result).toBe(SurveyQuestionBranchingType.End)
    })

    it('should branch based on rating response (scale 3)', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Rating,
          question: 'Rate this',
          scale: 3,
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              negative: 1, // 1 -> Question 2
              neutral: 2, // 2 -> Question 3
              positive: SurveyQuestionBranchingType.End, // 3 -> End
            },
          },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      let result = getNextSurveyStep(survey, 0, 1)
      expect(result).toBe(1)

      result = getNextSurveyStep(survey, 0, 2)
      expect(result).toBe(2)

      result = getNextSurveyStep(survey, 0, 3)
      expect(result).toBe(SurveyQuestionBranchingType.End)
    })

    it('should branch based on rating response (scale 7)', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Rating,
          question: 'Rate this',
          scale: 7,
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              negative: 1, // 1-3 -> Question 2
              neutral: 2, // 4 -> Question 3
              positive: SurveyQuestionBranchingType.End, // 5-7 -> End
            },
          },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      // Test negative
      let result = getNextSurveyStep(survey, 0, 1)
      expect(result).toBe(1)

      result = getNextSurveyStep(survey, 0, 3)
      expect(result).toBe(1)

      // Test neutral
      result = getNextSurveyStep(survey, 0, 4)
      expect(result).toBe(2)

      // Test positive
      result = getNextSurveyStep(survey, 0, 5)
      expect(result).toBe(SurveyQuestionBranchingType.End)

      result = getNextSurveyStep(survey, 0, 7)
      expect(result).toBe(SurveyQuestionBranchingType.End)
    })

    it('should throw error for invalid rating response type', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Rating,
          question: 'Rate this',
          scale: 5,
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              negative: 1,
            },
          },
        },
      ])

      expect(() => getNextSurveyStep(survey, 0, 'invalid')).toThrow('The response type must be an integer')
      expect(() => getNextSurveyStep(survey, 0, 3.5)).toThrow('The response type must be an integer')
    })

    it('should fall back to next question if no matching rating bucket', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Rating,
          question: 'Rate this',
          scale: 5,
          branching: {
            type: SurveyQuestionBranchingType.ResponseBased,
            responseValues: {
              negative: 2, // Only negative has branching
            },
          },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
        { type: SurveyQuestionType.Open, question: 'Question 3' },
      ])

      // Test positive rating (no branching defined)
      const result = getNextSurveyStep(survey, 0, 5)
      expect(result).toBe(1) // Should go to next question
    })
  })

  describe('Edge cases', () => {
    it('should handle unexpected branching type gracefully', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Open,
          question: 'Question 1',
          branching: { type: 'unknown_type' as any },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
      ])

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const result = getNextSurveyStep(survey, 0, 'response')

      expect(result).toBe(1)
      expect(consoleSpy).toHaveBeenCalledWith('Falling back to next question index due to unexpected branching type')

      consoleSpy.mockRestore()
    })

    it('should handle invalid specific question index', () => {
      const survey = createBasicSurvey([
        {
          type: SurveyQuestionType.Open,
          question: 'Question 1',
          branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 'invalid' as any },
        },
        { type: SurveyQuestionType.Open, question: 'Question 2' },
      ])

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const result = getNextSurveyStep(survey, 0, 'response')

      expect(result).toBe(1)
      expect(consoleSpy).toHaveBeenCalledWith('Falling back to next question index due to unexpected branching type')

      consoleSpy.mockRestore()
    })
  })
})
