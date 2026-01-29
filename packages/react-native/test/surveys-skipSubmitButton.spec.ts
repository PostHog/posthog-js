import { SurveyQuestionType, RatingSurveyQuestion, MultipleSurveyQuestion } from '@posthog/core'

describe('surveys - skipSubmitButton', () => {
  describe('RatingQuestion', () => {
    it.each([
      ['emoji', 5],
      ['number', 10],
    ] as const)('supports skipSubmitButton on %s display', (display, scale) => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'Test',
        display,
        scale,
        lowerBoundLabel: 'Low',
        upperBoundLabel: 'High',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
    })

    it('allows undefined skipSubmitButton', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'Test',
        display: 'emoji',
        scale: 3,
        lowerBoundLabel: 'Bad',
        upperBoundLabel: 'Good',
      }

      expect(question.skipSubmitButton).toBeUndefined()
    })

    it.each([2, 3, 5, 7, 10] as const)('supports skipSubmitButton on scale %d', (scale) => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'Test',
        display: 'number',
        scale,
        lowerBoundLabel: 'Low',
        upperBoundLabel: 'High',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
      expect(question.scale).toBe(scale)
    })
  })

  describe('MultipleChoiceQuestion', () => {
    it.each([
      [SurveyQuestionType.SingleChoice, 'single choice'],
      [SurveyQuestionType.MultipleChoice, 'multiple choice'],
    ] as const)('supports skipSubmitButton on %s questions', (type) => {
      const question: MultipleSurveyQuestion = {
        type,
        question: 'Test',
        choices: ['A', 'B', 'C'],
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
    })

    it('allows undefined skipSubmitButton', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.SingleChoice,
        question: 'Test',
        choices: ['A', 'B'],
      }

      expect(question.skipSubmitButton).toBeUndefined()
    })

    it('supports skipSubmitButton with hasOpenChoice', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.SingleChoice,
        question: 'Test',
        choices: ['A', 'Other'],
        hasOpenChoice: true,
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
      expect(question.hasOpenChoice).toBe(true)
    })
  })
})
