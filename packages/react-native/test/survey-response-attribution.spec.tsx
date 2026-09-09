/** @vitest-environment jsdom */
import React, { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Survey,
  SurveyQuestion,
  SurveyQuestionBranchingType,
  SurveyQuestionType,
  SurveyResponses,
  SurveyType,
} from '@posthog/core'
import type { PostHog } from '../src/posthog-rn'

// Only native views and capture are replaced. Navigation, response state and
// the shared event serializer run together, as they do in a survey session.
vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles } }))
const { capture } = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('../src/hooks/usePostHog', () => ({ usePostHog: () => ({ capture }) }))
vi.mock('../src/surveys/components/QuestionTypes', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Question = ({ question, onSubmit }: { question: SurveyQuestion; onSubmit: (value: string) => void }) =>
    React.createElement(
      'button',
      { 'data-testid': question.id, onClick: () => onSubmit(`answer-${question.id}`) },
      question.question
    )
  return {
    OpenTextQuestion: Question,
    LinkQuestion: Question,
    MultipleChoiceQuestion: Question,
    RatingQuestion: Question,
  }
})

import { dismissedSurveyEvent, Questions, sendSurveyEvent } from '../src/surveys/components/Surveys'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

const posthog = { capture } as unknown as PostHog

function makeSurvey(shuffleQuestions: boolean, overrides: Partial<Survey> = {}): Survey {
  const survey = {
    id: 'attribution',
    name: 'Response attribution',
    type: SurveyType.Popover,
    appearance: { shuffleQuestions },
    questions: ['q1', 'q2', 'q3'].map((id) => ({ id, type: SurveyQuestionType.Open, question: id })),
    ...overrides,
  } as Survey
  // Definitions from the API need not contain originalQuestionIndex. Freezing
  // also catches a fix that restores the properties by mutating during render.
  survey.questions.forEach(Object.freeze)
  Object.freeze(survey.questions)
  return Object.freeze(survey)
}

function SurveySession({ survey, onSubmit }: { survey: Survey; onSubmit: () => void }) {
  const [responses, setResponses] = useState<SurveyResponses>({})
  return (
    <>
      <Questions
        survey={survey}
        appearance={defaultSurveyAppearance}
        responses={responses}
        onResponsesChange={setResponses}
        onSubmit={onSubmit}
      />
      <button onClick={() => dismissedSurveyEvent(survey, responses, posthog)}>Dismiss</button>
    </>
  )
}

function expectCaptured(event: string, properties: Record<string, unknown>) {
  expect(capture).toHaveBeenCalledOnce()
  expect(capture).toHaveBeenCalledWith(event, properties)
}

afterEach(() => {
  cleanup()
  capture.mockReset()
  vi.restoreAllMocks()
})

describe('survey response attribution', () => {
  it.each([true, false])('preserves configured indices on submission (shuffle=%s)', (shuffle) => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const survey = makeSurvey(shuffle)
    const before = JSON.stringify(survey)
    const onSubmit = vi.fn()
    const { getByTestId } = render(<SurveySession survey={survey} onSubmit={onSubmit} />)
    const displayOrder = shuffle ? ['q2', 'q3', 'q1'] : ['q1', 'q2', 'q3']
    for (const id of displayOrder) {
      fireEvent.click(getByTestId(id))
    }

    expect(onSubmit).toHaveBeenCalledOnce()
    expectCaptured('survey sent', {
      $survey_id: 'attribution',
      $survey_name: 'Response attribution',
      $survey_questions: ['q1', 'q2', 'q3'].map((id) => ({ id, question: id, response: `answer-${id}` })),
      $survey_response_q1: 'answer-q1',
      $survey_response_q2: 'answer-q2',
      $survey_response_q3: 'answer-q3',
      $survey_response: 'answer-q1',
      $survey_response_1: 'answer-q2',
      $survey_response_2: 'answer-q3',
      $set: { '$survey_responded/attribution': true },
    })
    expect(JSON.stringify(survey)).toBe(before)
  })

  it.each([true, false])('preserves configured indices on dismissal (shuffle=%s)', (shuffle) => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const survey = makeSurvey(shuffle)
    const before = JSON.stringify(survey)
    const onSubmit = vi.fn()
    const { getByTestId, getByText } = render(<SurveySession survey={survey} onSubmit={onSubmit} />)
    const first = shuffle ? 'q2' : 'q1'
    fireEvent.click(getByTestId(first))
    fireEvent.click(getByText('Dismiss'))

    expect(onSubmit).not.toHaveBeenCalled()
    expectCaptured('survey dismissed', {
      $survey_id: 'attribution',
      $survey_name: 'Response attribution',
      $survey_partially_completed: true,
      $survey_questions: ['q1', 'q2', 'q3'].map((id) => ({
        id,
        question: id,
        response: id === first ? `answer-${id}` : undefined,
      })),
      [`$survey_response_${first}`]: `answer-${first}`,
      [shuffle ? '$survey_response_1' : '$survey_response']: `answer-${first}`,
      $set: { '$survey_dismissed/attribution': true },
    })
    expect(JSON.stringify(survey)).toBe(before)
  })

  it('does not renumber answers when branching skips a question', () => {
    const survey = makeSurvey(true, {
      questions: [
        {
          id: 'q1',
          type: SurveyQuestionType.Open,
          question: 'q1',
          branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 2 },
        },
        { id: 'q2', type: SurveyQuestionType.Open, question: 'q2' },
        { id: 'q3', type: SurveyQuestionType.Open, question: 'q3' },
      ] as SurveyQuestion[],
    })
    const onSubmit = vi.fn()
    const { getByTestId } = render(<SurveySession survey={survey} onSubmit={onSubmit} />)
    fireEvent.click(getByTestId('q1'))
    fireEvent.click(getByTestId('q3'))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledOnce()
    const [event, properties] = capture.mock.calls[0]
    expect(event).toBe('survey sent')
    expect(properties).toMatchObject({
      $survey_response_q1: 'answer-q1',
      $survey_response_q3: 'answer-q3',
      $survey_response: 'answer-q1',
      $survey_response_2: 'answer-q3',
    })
    expect(properties).not.toHaveProperty('$survey_response_1')
    expect(properties).not.toHaveProperty('$survey_response_q2')
  })

  it.each(['sent', 'dismissed'] as const)('serializes %s responses without a prior render', (event) => {
    const survey = makeSurvey(false, {
      current_iteration: 2,
      current_iteration_start_date: '2026-09-07',
      questions: ['q1', 'q2', 'q3', 'q4'].map((id) => ({
        id,
        type: SurveyQuestionType.Open,
        question: id,
      })) as SurveyQuestion[],
    })
    const values = [0, null, '', ['A', 'C']]
    const responses: SurveyResponses = {
      $survey_response_q1: 0,
      $survey_response_q2: null,
      $survey_response_q3: '',
      $survey_response_q4: ['A', 'C'],
    }
    const before = JSON.stringify({ survey, responses })
    if (event === 'sent') {
      sendSurveyEvent(responses, survey, posthog, 'pt')
    } else {
      dismissedSurveyEvent(survey, responses, posthog, 'pt')
    }

    expectCaptured(`survey ${event}`, {
      $survey_id: 'attribution',
      $survey_name: 'Response attribution',
      $survey_iteration: 2,
      $survey_iteration_start_date: '2026-09-07',
      $survey_language: 'pt',
      ...(event === 'dismissed' ? { $survey_partially_completed: true } : {}),
      $survey_questions: survey.questions.map((question, index) => ({
        id: question.id,
        question: question.question,
        response: values[index],
      })),
      ...responses,
      $survey_response: 0,
      $survey_response_1: null,
      $survey_response_2: '',
      $survey_response_3: ['A', 'C'],
      $set: { [`$survey_${event === 'sent' ? 'responded' : 'dismissed'}/attribution/2`]: true },
    })
    expect(JSON.stringify({ survey, responses })).toBe(before)
    expect(capture.mock.calls[0][1].$survey_response_3).not.toBe(responses.$survey_response_q4)
  })

  it('does not invent responses for an unanswered dismissal', () => {
    const survey = makeSurvey(true)
    dismissedSurveyEvent(survey, {}, posthog)
    expectCaptured('survey dismissed', {
      $survey_id: 'attribution',
      $survey_name: 'Response attribution',
      $survey_partially_completed: false,
      $survey_questions: survey.questions.map((question) => ({
        id: question.id,
        question: question.question,
        response: undefined,
      })),
      $set: { '$survey_dismissed/attribution': true },
    })
  })
})
