import { afterEach, describe, expect, it, vi } from 'vitest'
import { Survey, SurveyQuestionBranchingType, SurveyQuestionType } from '@posthog/core'
import {
  getDisplayOrderChoices,
  getDisplayOrderQuestions,
  shouldShuffleQuestions,
  shuffle,
} from '../src/surveys/survey-shuffling'

const question = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: SurveyQuestionType.Open,
    question: id,
    ...extra,
  }) as any

const survey = (extra: Record<string, unknown> = {}): Survey =>
  ({
    id: 'survey-1',
    name: 'Survey',
    questions: [question('q1'), question('q2'), question('q3')],
    appearance: { shuffleQuestions: true },
    ...extra,
  }) as Survey

afterEach(() => {
  vi.restoreAllMocks()
})

describe('survey shuffling', () => {
  it('uses Fisher-Yates without mutating the source array', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0)
    const input = ['a', 'b', 'c']

    expect(shuffle(input)).toEqual(['b', 'c', 'a'])
    expect(input).toEqual(['a', 'b', 'c'])
  })

  it('shuffles questions and preserves their configured indices', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0)
    const source = survey()

    const displayed = getDisplayOrderQuestions(source)

    expect(displayed.map((q) => q.id)).toEqual(['q2', 'q3', 'q1'])
    expect(displayed.map((q) => q.originalQuestionIndex)).toEqual([1, 2, 0])
    expect(source.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
    expect(source.questions.map((q) => q.originalQuestionIndex)).toEqual([undefined, undefined, undefined])
  })

  it('forces a different order when randomness produces the identity permutation', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)

    expect(getDisplayOrderQuestions(survey()).map((q) => q.id)).toEqual(['q3', 'q2', 'q1'])
  })

  it('does not shuffle questions when the feature is off', () => {
    const source = survey({ appearance: { shuffleQuestions: false } })

    expect(shouldShuffleQuestions(source)).toBe(false)
    expect(getDisplayOrderQuestions(source).map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
  })

  it('does not shuffle partial-response surveys because their progress is positional', () => {
    const source = survey({ enable_partial_responses: true })

    expect(shouldShuffleQuestions(source)).toBe(false)
    expect(getDisplayOrderQuestions(source).map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
  })

  it('does not shuffle legacy surveys containing branching rules', () => {
    const source = survey({
      questions: [
        question('q1', {
          branching: {
            type: SurveyQuestionBranchingType.SpecificQuestion,
            index: 2,
          },
        }),
        question('q2'),
        question('q3'),
      ],
    })

    expect(shouldShuffleQuestions(source)).toBe(false)
    expect(getDisplayOrderQuestions(source).map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
  })

  it('shuffles choices without mutating the question', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0)
    const source = {
      id: 'q1',
      type: SurveyQuestionType.MultipleChoice,
      question: 'Pick one',
      choices: ['a', 'b', 'c'],
      shuffleOptions: true,
    } as any

    expect(getDisplayOrderChoices(source)).toEqual(['b', 'c', 'a'])
    expect(source.choices).toEqual(['a', 'b', 'c'])
  })

  it('keeps the open-ended choice last while shuffling the other options', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0)
    const source = {
      id: 'q1',
      type: SurveyQuestionType.MultipleChoice,
      question: 'Pick one',
      choices: ['a', 'b', 'c', 'Other'],
      shuffleOptions: true,
      hasOpenChoice: true,
    } as any

    expect(getDisplayOrderChoices(source)).toEqual(['b', 'c', 'a', 'Other'])
    expect(source.choices).toEqual(['a', 'b', 'c', 'Other'])
  })

  it('returns configured choice order when shuffling is disabled', () => {
    const source = {
      id: 'q1',
      type: SurveyQuestionType.SingleChoice,
      question: 'Pick one',
      choices: ['a', 'b', 'c'],
      shuffleOptions: false,
    } as any

    expect(getDisplayOrderChoices(source)).toEqual(['a', 'b', 'c'])
  })

  it('handles zero and one shufflable choice safely', () => {
    expect(
      getDisplayOrderChoices({
        id: 'q1',
        type: SurveyQuestionType.MultipleChoice,
        question: 'Empty',
        choices: [],
        shuffleOptions: true,
      } as any)
    ).toEqual([])

    expect(
      getDisplayOrderChoices({
        id: 'q2',
        type: SurveyQuestionType.MultipleChoice,
        question: 'One',
        choices: ['only'],
        shuffleOptions: true,
      } as any)
    ).toEqual(['only'])
  })
})
