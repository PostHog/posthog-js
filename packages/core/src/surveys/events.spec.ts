import { describe, expect, it } from 'vitest'
import {
  buildSurveyResponseProperties,
  buildSurveyResponseEventProperties,
  recordSurveyAnswer,
  getSurveyInteractionProperty,
  getSurveyResponseKey,
  getSurveyResponseValue,
  surveyHasResponses,
} from './events'

describe('survey event helpers', () => {
  const survey = {
    id: 'survey-1',
    current_iteration: 2,
    questions: [
      { id: 'q1', question: 'Rate us', originalQuestionIndex: 0 },
      { id: 'q2', question: 'Anything else?', originalQuestionIndex: 1 },
    ],
  }

  it('builds response properties with current and legacy response keys', () => {
    const responses = {
      [getSurveyResponseKey('q1')]: 5,
      [getSurveyResponseKey('q2')]: ['fast', 'clear'],
    }

    expect(buildSurveyResponseProperties(responses, survey)).toEqual({
      $survey_questions: [
        { id: 'q1', question: 'Rate us', response: 5 },
        { id: 'q2', question: 'Anything else?', response: ['fast', 'clear'] },
      ],
      $survey_response_q1: 5,
      $survey_response_q2: ['fast', 'clear'],
      $survey_response: 5,
      $survey_response_1: ['fast', 'clear'],
    })
  })

  it('prefers question snapshots over the current question text', () => {
    const responses = { [getSurveyResponseKey('q1')]: 5 }
    const questionSnapshots = { q1: 'Rate us (French)' }

    expect(buildSurveyResponseProperties(responses, survey, questionSnapshots)).toEqual(
      expect.objectContaining({
        $survey_questions: [
          { id: 'q1', question: 'Rate us (French)', response: 5 },
          { id: 'q2', question: 'Anything else?', response: undefined },
        ],
      })
    )
  })

  it('falls back to the current question text for a question with no snapshot', () => {
    const questionSnapshots = { q1: 'Rate us (French)' }

    expect(buildSurveyResponseProperties({}, survey, questionSnapshots)).toEqual(
      expect.objectContaining({
        $survey_questions: expect.arrayContaining([{ id: 'q2', question: 'Anything else?', response: undefined }]),
      })
    )
  })

  it('falls back to the current question text when the question id is an empty string', () => {
    const surveyWithEmptyId = {
      ...survey,
      questions: [{ id: '', question: 'Untitled', originalQuestionIndex: 0 }],
    }
    // A snapshot recorded under the empty-string key must not be picked up for a
    // question whose id is also '' — only an explicit questionSnapshots[''] set by
    // the caller should ever surface here, and there is none in this case.
    const questionSnapshots = {}

    expect(buildSurveyResponseProperties({}, surveyWithEmptyId, questionSnapshots)).toEqual(
      expect.objectContaining({
        $survey_questions: [{ id: '', question: 'Untitled', response: null }],
      })
    )
  })

  it('copies array response values before returning them', () => {
    const responses = { [getSurveyResponseKey('q1')]: ['a'] }

    const response = getSurveyResponseValue(responses, 'q1')

    expect(response).toEqual(['a'])
    expect(response).not.toBe(responses.$survey_response_q1)
  })

  it('detects non-nullish responses and builds interaction property names', () => {
    expect(surveyHasResponses({ $survey_response_q1: null })).toBe(false)
    expect(surveyHasResponses({ $survey_response_q1: 0 })).toBe(true)
    expect(getSurveyInteractionProperty(survey, 'responded')).toBe('$survey_responded/survey-1/2')
  })
})

describe('recordSurveyAnswer', () => {
  it.each([0, '', null, ['fast', 'clear']])('records %j without mutating previous answers or snapshots', (response) => {
    const previous = {
      responses: { $survey_response_q1: 5 },
      questionSnapshots: { q1: 'Rate us (French)' },
    }
    expect(recordSurveyAnswer(previous, 'q2', response, { id: 'q2', question: 'Anything else?' })).toEqual({
      responses: { $survey_response_q1: 5, $survey_response_q2: response },
      questionSnapshots: { q1: 'Rate us (French)', q2: 'Anything else?' },
    })
    expect(previous).toEqual({
      responses: { $survey_response_q1: 5 },
      questionSnapshots: { q1: 'Rate us (French)' },
    })
  })

  it('replaces the answer and its snapshot when a question is answered again', () => {
    expect(
      recordSurveyAnswer(
        {
          responses: { $survey_response_q1: 5 },
          questionSnapshots: { q1: 'Rate us (French)' },
        },
        'q1',
        0,
        { id: 'q1', question: '' }
      )
    ).toEqual({
      responses: { $survey_response_q1: 0 },
      questionSnapshots: { q1: '' },
    })
  })

  it('accepts progress without snapshots and does not invent missing question text', () => {
    expect(recordSurveyAnswer({ responses: {} }, 'q1', 5)).toEqual({
      responses: { $survey_response_q1: 5 },
      questionSnapshots: {},
    })
  })
})

describe('buildSurveyResponseEventProperties', () => {
  const survey = { questions: [{ id: 'q1', question: 'Rate us', originalQuestionIndex: 0 }] }

  it.each([
    ['sent', false, { $survey_completed: false }],
    ['sent', true, { $survey_completed: true }],
    ['dismissed', undefined, { $survey_partially_completed: true }],
    ['abandoned', undefined, { $survey_partially_completed: true }],
  ] as const)('builds %s event properties (completed=%s) with answer-time text', (event, completed, metadata) => {
    expect(
      buildSurveyResponseEventProperties({
        event,
        survey,
        completed,
        submissionId: 'submission-1',
        surveyLanguage: 'fr',
        responses: { $survey_response_q1: 0 },
        questionSnapshots: { q1: 'Notez-nous' },
      })
    ).toEqual({
      ...metadata,
      $survey_submission_id: 'submission-1',
      $survey_language: 'fr',
      $survey_questions: [{ id: 'q1', question: 'Notez-nous', response: 0 }],
      $survey_response_q1: 0,
      $survey_response: 0,
    })
  })

  it('keeps metadata optional for callers without submission state or a matched language', () => {
    const properties = buildSurveyResponseEventProperties({ event: 'sent', survey, surveyLanguage: null })
    expect(properties).not.toHaveProperty('$survey_submission_id')
    expect(properties).not.toHaveProperty('$survey_completed')
    expect(properties).not.toHaveProperty('$survey_partially_completed')
    expect(properties).not.toHaveProperty('$survey_language')
  })

  it.each([{}, { $survey_response_q1: null }])(
    'does not count absent or skipped answers as partial completion',
    (responses) => {
      expect(buildSurveyResponseEventProperties({ event: 'dismissed', survey, responses })).toMatchObject({
        $survey_partially_completed: false,
      })
    }
  )
})
