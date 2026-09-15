import { afterEach, describe, expect, it, vi } from 'vitest'
import { SurveyQuestionType } from '../types'
import { getDisplayOrderChoices, shuffle } from './shuffling'

afterEach(() => vi.restoreAllMocks())

describe('survey choice shuffling', () => {
  const question = (choices: string[], shuffleOptions = true, hasOpenChoice = false) => ({
    type: SurveyQuestionType.SingleChoice as const,
    question: 'Pick one',
    choices,
    shuffleOptions,
    hasOpenChoice,
  })

  it('uses Fisher-Yates without mutating the input', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const source = Object.freeze(['a', 'b', 'c'])
    expect(shuffle(source)).toEqual(['b', 'c', 'a'])
    expect(source).toEqual(['a', 'b', 'c'])
  })

  it.each([false, true])('keeps Other last without mutating choices (open=%s)', (hasOpenChoice) => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const source = question(['a', 'b', 'c', ...(hasOpenChoice ? ['Other'] : [])], true, hasOpenChoice)
    Object.freeze(source.choices)
    Object.freeze(source)
    expect(getDisplayOrderChoices(source)).toEqual(['b', 'c', 'a', ...(hasOpenChoice ? ['Other'] : [])])
    expect(getDisplayOrderChoices(source)).toEqual(['b', 'c', 'a', ...(hasOpenChoice ? ['Other'] : [])])
  })

  it('reverses the regular choices if randomness leaves their order unchanged', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(getDisplayOrderChoices(question(['a', 'b', 'c', 'Other'], true, true))).toEqual(['c', 'b', 'a', 'Other'])
  })

  it.each([false, undefined])('preserves configured order when shuffleOptions=%s', (shuffleOptions) => {
    const source = { ...question(['a', 'b', 'Other'], false, true), shuffleOptions }
    expect(getDisplayOrderChoices(source)).toBe(source.choices)
  })

  it.each([[], ['Other'], ['a', 'Other'], ['a', 'a', 'Other'], ['a', 'b', '']])(
    'retains every choice in %j',
    (...choices) => {
      const source = question(choices, true, true)
      const result = getDisplayOrderChoices(source)
      expect([...result].sort()).toEqual([...choices].sort())
      if (choices.length) expect(result[result.length - 1]).toBe(choices[choices.length - 1])
    }
  )
})
