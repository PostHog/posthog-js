import { sendSurveyEvent } from '../src/surveys/components/Surveys'
import { Survey, SurveyQuestion } from '@posthog/core'

describe('sendSurveyEvent', () => {
  let mockPostHog: any

  beforeEach(() => {
    mockPostHog = {
      capture: jest.fn(),
    }
  })

  const createMockSurvey = (overrides: Partial<Survey> = {}): Survey => ({
    id: 'test-survey-id',
    name: 'Test Survey',
    questions: [
      {
        id: 'question-1',
        question: 'How satisfied are you?',
        type: 'rating',
        scale: 5,
        originalQuestionIndex: 0,
      } as SurveyQuestion,
      {
        id: 'question-2',
        question: 'Any additional comments?',
        type: 'open',
        originalQuestionIndex: 1,
      } as SurveyQuestion,
    ],
    ...overrides,
  })

  describe('basic functionality', () => {
    it('should capture survey sent event with correct base properties', () => {
      const survey = createMockSurvey()
      const responses = {
        '$survey_response_question-1': 4,
        '$survey_response_question-2': 'Great service!',
      }

      sendSurveyEvent(responses, survey, mockPostHog)

      expect(mockPostHog.capture).toHaveBeenCalledWith('survey sent', {
        $survey_name: 'Test Survey',
        $survey_id: 'test-survey-id',
        $survey_questions: [
          {
            id: 'question-1',
            question: 'How satisfied are you?',
            response: 4,
          },
          {
            id: 'question-2',
            question: 'Any additional comments?',
            response: 'Great service!',
          },
        ],
        '$survey_response_question-1': 4,
        '$survey_response_question-2': 'Great service!',
        $survey_response: 4,
        $survey_response_1: 'Great service!',
        $set: {
          '$survey_responded/test-survey-id': true,
        },
      })
    })
  })

  describe('survey iterations', () => {
    it('should include iteration properties when survey has current_iteration', () => {
      const survey = createMockSurvey({
        current_iteration: 2,
        current_iteration_start_date: '2024-01-15',
      })
      const responses = {
        '$survey_response_question-1': 4,
        '$survey_response_question-2': 'Great service!',
      }

      sendSurveyEvent(responses, survey, mockPostHog)

      expect(mockPostHog.capture).toHaveBeenCalledWith('survey sent', {
        $survey_name: 'Test Survey',
        $survey_id: 'test-survey-id',
        $survey_iteration: 2,
        $survey_iteration_start_date: '2024-01-15',
        $survey_questions: [
          {
            id: 'question-1',
            question: 'How satisfied are you?',
            response: 4,
          },
          {
            id: 'question-2',
            question: 'Any additional comments?',
            response: 'Great service!',
          },
        ],
        '$survey_response_question-1': 4,
        '$survey_response_question-2': 'Great service!',
        $survey_response: 4,
        $survey_response_1: 'Great service!',
        $set: {
          '$survey_responded/test-survey-id/2': true,
        },
      })
    })

    it('should not include iteration properties when survey has no current_iteration', () => {
      const survey = createMockSurvey({
        current_iteration: undefined,
        current_iteration_start_date: undefined,
      })
      const responses = { '$survey_response_question-1': 3 }

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      expect(captureCall).not.toHaveProperty('$survey_iteration')
      expect(captureCall).not.toHaveProperty('$survey_iteration_start_date')
      expect(captureCall.$set).toEqual({
        '$survey_responded/test-survey-id': true,
      })
    })
  })

  describe('response handling', () => {
    it('should handle string responses', () => {
      const survey = createMockSurvey()
      const responses = {
        '$survey_response_question-2': 'This is a text response',
      }

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      expect(captureCall.$survey_questions[1].response).toBe('This is a text response')
    })

    it('should handle numeric responses', () => {
      const survey = createMockSurvey()
      const responses = {
        '$survey_response_question-1': 5,
      }

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      expect(captureCall.$survey_questions[0].response).toBe(5)
    })

    it('should handle array responses by creating a copy', () => {
      const survey = createMockSurvey({
        questions: [
          {
            id: 'question-multi',
            question: 'Select all that apply',
            type: 'multiple_choice',
            choices: ['Option 1', 'Option 2', 'Option 3'],
          } as SurveyQuestion,
        ],
      })
      const originalArray = ['Option 1', 'Option 3']
      const responses = {
        '$survey_response_question-multi': originalArray,
      }

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      const responseArray = captureCall.$survey_questions[0].response

      expect(responseArray).toEqual(['Option 1', 'Option 3'])
      expect(responseArray).not.toBe(originalArray) // Should be a copy, not the same reference
    })

    it('should handle null responses', () => {
      const survey = createMockSurvey()
      const responses = {
        '$survey_response_question-1': null,
      }

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      expect(captureCall.$survey_questions[0].response).toBeNull()
    })

    it('should return null for questions without responses', () => {
      const survey = createMockSurvey()
      const responses = {
        '$survey_response_question-1': 4,
        // question-2 has no response
      }

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      expect(captureCall.$survey_questions[0].response).toBe(4)
      expect(captureCall.$survey_questions[1].response).toBeUndefined()
    })
  })

  describe('survey interaction property', () => {
    it('should generate correct interaction property without iteration', () => {
      const survey = createMockSurvey()
      const responses = {}

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      expect(captureCall.$set).toEqual({
        '$survey_responded/test-survey-id': true,
      })
    })

    it('should generate correct interaction property with iteration', () => {
      const survey = createMockSurvey({
        current_iteration: 3,
      })
      const responses = {}

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      expect(captureCall.$set).toEqual({
        '$survey_responded/test-survey-id/3': true,
      })
    })
  })

  describe('complex scenarios', () => {
    it('should handle survey with mixed question types and responses', () => {
      const survey = createMockSurvey({
        questions: [
          {
            id: 'rating-q',
            question: 'Rate us',
            type: 'rating',
            scale: 10,
          } as SurveyQuestion,
          {
            id: 'multi-q',
            question: 'Select options',
            type: 'multiple_choice',
            choices: ['A', 'B', 'C'],
          } as SurveyQuestion,
          {
            id: 'text-q',
            question: 'Comments',
            type: 'open',
          } as SurveyQuestion,
        ],
      })
      const responses = {
        '$survey_response_rating-q': 8,
        '$survey_response_multi-q': ['A', 'C'],
        '$survey_response_text-q': 'Good job!',
      }

      sendSurveyEvent(responses, survey, mockPostHog)

      const captureCall = mockPostHog.capture.mock.calls[0][1]
      expect(captureCall.$survey_questions).toEqual([
        {
          id: 'rating-q',
          question: 'Rate us',
          response: 8,
        },
        {
          id: 'multi-q',
          question: 'Select options',
          response: ['A', 'C'],
        },
        {
          id: 'text-q',
          question: 'Comments',
          response: 'Good job!',
        },
      ])
    })
  })
})
