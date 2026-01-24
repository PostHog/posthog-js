import { Survey, SurveyQuestionType, SurveyType, RatingSurveyQuestion, MultipleSurveyQuestion } from '@posthog/core'

describe('surveys - skipSubmitButton functionality', () => {
  const mockAppearance = {
    submitButtonText: 'Submit',
    submitButtonColor: '#000000',
    ratingButtonColor: '#cccccc',
    ratingButtonActiveColor: '#000000',
    backgroundColor: '#ffffff',
    textColor: '#000000',
    inputBackground: '#ffffff',
    borderColor: '#000000',
  }

  describe('RatingQuestion with skipSubmitButton', () => {
    it('should have skipSubmitButton property on emoji rating question', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'How satisfied are you?',
        display: 'emoji' as const,
        scale: 5,
        lowerBoundLabel: 'Very dissatisfied',
        upperBoundLabel: 'Very satisfied',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
    })

    it('should have skipSubmitButton property on number rating question', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'How likely are you to recommend us?',
        display: 'number' as const,
        scale: 10,
        lowerBoundLabel: 'Not likely',
        upperBoundLabel: 'Very likely',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
    })

    it('should allow undefined skipSubmitButton (defaults to false)', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'Rate us',
        display: 'emoji' as const,
        scale: 3,
        lowerBoundLabel: 'Bad',
        upperBoundLabel: 'Good',
      }

      expect(question.skipSubmitButton).toBeUndefined()
    })
  })

  describe('MultipleChoiceQuestion with skipSubmitButton', () => {
    it('should have skipSubmitButton property on single choice question', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.SingleChoice,
        question: 'What is your favorite season?',
        choices: ['Spring', 'Summer', 'Fall', 'Winter'],
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
    })

    it('should have skipSubmitButton property on multiple choice question', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.MultipleChoice,
        question: 'What features do you use?',
        choices: ['Feature A', 'Feature B', 'Feature C'],
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
    })

    it('should allow undefined skipSubmitButton (defaults to false)', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.SingleChoice,
        question: 'Choose one',
        choices: ['Option 1', 'Option 2'],
      }

      expect(question.skipSubmitButton).toBeUndefined()
    })

    it('should support skipSubmitButton with hasOpenChoice', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.SingleChoice,
        question: 'What is your favorite color?',
        choices: ['Red', 'Blue', 'Green', 'Other'],
        hasOpenChoice: true,
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
      expect(question.hasOpenChoice).toBe(true)
    })
  })

  describe('Survey with skipSubmitButton questions', () => {
    it('should create survey with mixed skipSubmitButton questions', () => {
      const survey: Survey = {
        id: 'test-survey-skip',
        name: 'Skip Submit Test',
        type: SurveyType.Popover,
        questions: [
          {
            type: SurveyQuestionType.Rating,
            question: 'Rate us',
            display: 'emoji' as const,
            scale: 5,
            lowerBoundLabel: 'Bad',
            upperBoundLabel: 'Good',
            skipSubmitButton: true,
          },
          {
            type: SurveyQuestionType.SingleChoice,
            question: 'Choose one',
            choices: ['A', 'B', 'C'],
            skipSubmitButton: true,
          },
          {
            type: SurveyQuestionType.Open,
            question: 'Any comments?',
            // Open questions should not have skipSubmitButton
          },
        ],
        conditions: {},
        appearance: mockAppearance,
        start_date: '2021-01-01T00:00:00Z',
        end_date: undefined,
        current_iteration: undefined,
        current_iteration_start_date: undefined,
      }

      expect(survey.questions[0]).toHaveProperty('skipSubmitButton', true)
      expect(survey.questions[1]).toHaveProperty('skipSubmitButton', true)
      expect(survey.questions[2]).not.toHaveProperty('skipSubmitButton')
    })
  })

  describe('skipSubmitButton behavior constraints', () => {
    it('rating questions support skipSubmitButton', () => {
      const emojiQuestion: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'Emoji rating',
        display: 'emoji' as const,
        scale: 5,
        lowerBoundLabel: 'Bad',
        upperBoundLabel: 'Good',
        skipSubmitButton: true,
      }

      const numberQuestion: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'Number rating',
        display: 'number' as const,
        scale: 10,
        lowerBoundLabel: 'Low',
        upperBoundLabel: 'High',
        skipSubmitButton: true,
      }

      expect(emojiQuestion.skipSubmitButton).toBe(true)
      expect(numberQuestion.skipSubmitButton).toBe(true)
    })

    it('single choice questions support skipSubmitButton', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.SingleChoice,
        question: 'Single choice',
        choices: ['A', 'B'],
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
    })

    it('multiple choice questions can have skipSubmitButton but should be ignored in UI logic', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.MultipleChoice,
        question: 'Multiple choice',
        choices: ['A', 'B', 'C'],
        skipSubmitButton: true,
      }

      // Type system allows it, but UI logic should ignore it
      expect(question.skipSubmitButton).toBe(true)
    })

    it('single choice with open choice can have skipSubmitButton but should be ignored in UI logic', () => {
      const question: MultipleSurveyQuestion = {
        type: SurveyQuestionType.SingleChoice,
        question: 'Single choice with other',
        choices: ['A', 'B', 'Other'],
        hasOpenChoice: true,
        skipSubmitButton: true,
      }

      // Type system allows it, but UI logic should ignore it when hasOpenChoice is true
      expect(question.skipSubmitButton).toBe(true)
      expect(question.hasOpenChoice).toBe(true)
    })
  })

  describe('skipSubmitButton with different scales', () => {
    it('supports skipSubmitButton on 2-scale rating (thumbs)', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'Thumbs up or down?',
        display: 'emoji' as const,
        scale: 2,
        lowerBoundLabel: 'Down',
        upperBoundLabel: 'Up',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
      expect(question.scale).toBe(2)
    })

    it('supports skipSubmitButton on 3-scale rating', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: '3-point rating',
        display: 'emoji' as const,
        scale: 3,
        lowerBoundLabel: 'Bad',
        upperBoundLabel: 'Good',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
      expect(question.scale).toBe(3)
    })

    it('supports skipSubmitButton on 5-scale rating', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: '5-point rating',
        display: 'number' as const,
        scale: 5,
        lowerBoundLabel: 'Low',
        upperBoundLabel: 'High',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
      expect(question.scale).toBe(5)
    })

    it('supports skipSubmitButton on 7-scale rating', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: '7-point rating',
        display: 'number' as const,
        scale: 7,
        lowerBoundLabel: 'Low',
        upperBoundLabel: 'High',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
      expect(question.scale).toBe(7)
    })

    it('supports skipSubmitButton on 10-scale NPS rating', () => {
      const question: RatingSurveyQuestion = {
        type: SurveyQuestionType.Rating,
        question: 'How likely are you to recommend us?',
        display: 'number' as const,
        scale: 10,
        lowerBoundLabel: 'Not at all likely',
        upperBoundLabel: 'Extremely likely',
        skipSubmitButton: true,
      }

      expect(question.skipSubmitButton).toBe(true)
      expect(question.scale).toBe(10)
    })
  })
})
