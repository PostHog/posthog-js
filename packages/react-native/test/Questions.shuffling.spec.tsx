/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Survey, SurveyQuestionBranchingType, SurveyQuestionType, SurveyType } from '@posthog/core'

vi.mock('react-native', async () => {
  return {
    StyleSheet: { create: (styles: any) => styles },
  }
})

const capture = vi.fn()
vi.mock('../src/hooks/usePostHog', () => ({
  usePostHog: () => ({ capture }),
}))

vi.mock('../src/surveys/components/QuestionTypes', async () => {
  const RealReact = await vi.importActual<typeof import('react')>('react')
  const Question = ({ question, onSubmit }: any) =>
    RealReact.createElement(
      'button',
      {
        'data-testid': `question-${question.id}`,
        onClick: () => onSubmit(question.id),
      },
      question.question
    )

  return {
    OpenTextQuestion: Question,
    LinkQuestion: Question,
    MultipleChoiceQuestion: Question,
    RatingQuestion: Question,
  }
})

import { Questions } from '../src/surveys/components/Surveys'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

const makeSurvey = (overrides: Partial<Survey> = {}): Survey =>
  ({
    id: 'survey-1',
    name: 'Shuffle survey',
    type: SurveyType.Popover,
    appearance: { shuffleQuestions: true },
    questions: [
      { id: 'q1', type: SurveyQuestionType.Open, question: 'Question 1' },
      { id: 'q2', type: SurveyQuestionType.Open, question: 'Question 2' },
      { id: 'q3', type: SurveyQuestionType.Open, question: 'Question 3' },
    ],
    ...overrides,
  }) as Survey

afterEach(() => {
  cleanup()
  capture.mockReset()
  vi.restoreAllMocks()
})

describe('Questions shuffling', () => {
  it('advances through shuffled display order without skipping questions', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const onSubmit = vi.fn()
    const onResponsesChange = vi.fn()
    const { getByTestId, queryByTestId } = render(
      <Questions
        survey={makeSurvey()}
        appearance={defaultSurveyAppearance}
        onSubmit={onSubmit}
        onResponsesChange={onResponsesChange}
      />
    )

    expect(getByTestId('question-q2')).not.toBeNull()

    act(() => fireEvent.click(getByTestId('question-q2')))
    expect(getByTestId('question-q3')).not.toBeNull()

    act(() => fireEvent.click(getByTestId('question-q3')))
    expect(getByTestId('question-q1')).not.toBeNull()

    act(() => fireEvent.click(getByTestId('question-q1')))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(queryByTestId('question-q1')).not.toBeNull()
    expect(onResponsesChange).toHaveBeenCalledTimes(3)
  })

  it('keeps configured branching semantics even if legacy data also asks to shuffle', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const onSubmit = vi.fn()
    const survey = makeSurvey({
      questions: [
        {
          id: 'q1',
          type: SurveyQuestionType.Open,
          question: 'Question 1',
          branching: { type: SurveyQuestionBranchingType.SpecificQuestion, index: 2 },
        },
        { id: 'q2', type: SurveyQuestionType.Open, question: 'Question 2' },
        { id: 'q3', type: SurveyQuestionType.Open, question: 'Question 3' },
      ] as any,
    })
    const { getByTestId } = render(
      <Questions survey={survey} appearance={defaultSurveyAppearance} onSubmit={onSubmit} />
    )

    expect(getByTestId('question-q1')).not.toBeNull()
    act(() => fireEvent.click(getByTestId('question-q1')))
    expect(getByTestId('question-q3')).not.toBeNull()
  })
})
