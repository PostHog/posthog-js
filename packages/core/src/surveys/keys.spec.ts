import { describe, expect, it } from '@jest/globals'
import { getSurveyIterationKey } from './keys'

describe('getSurveyIterationKey', () => {
  const cases: [number | null | undefined, string][] = [
    [2, 'survey-1_2'],
    [1, 'survey-1_1'],
    [0, 'survey-1'],
    [null, 'survey-1'],
    [undefined, 'survey-1'],
  ]

  it.each(cases)('current_iteration %p produces key %p', (currentIteration, expected) => {
    expect(getSurveyIterationKey({ id: 'survey-1', current_iteration: currentIteration })).toBe(expected)
  })
})
