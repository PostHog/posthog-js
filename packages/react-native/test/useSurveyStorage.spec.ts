import { updateSeenSurveys } from '../src/surveys/useSurveyStorage'

describe('updateSeenSurveys', () => {
  it.each([
    [
      'replaces the pre-iteration bare id',
      ['survey-1', 'other'],
      { id: 'survey-1', current_iteration: 2 },
      ['survey-1_2', 'other'],
    ],
    [
      'replaces a previous iteration key',
      ['survey-1_1', 'other'],
      { id: 'survey-1', current_iteration: 2 },
      ['survey-1_2', 'other'],
    ],
    [
      'dedupes the current key',
      ['survey-1_2', 'other'],
      { id: 'survey-1', current_iteration: 2 },
      ['survey-1_2', 'other'],
    ],
    [
      'leaves other surveys untouched',
      ['survey-10_1'],
      { id: 'survey-1', current_iteration: 2 },
      ['survey-1_2', 'survey-10_1'],
    ],
  ])('%s', (_name, current, survey, expected) => {
    expect(updateSeenSurveys(current, survey)).toEqual(expected)
  })

  it('caps the list at 20 entries, evicting the oldest', () => {
    const current = Array.from({ length: 20 }, (_, i) => `survey-${i}`)
    const result = updateSeenSurveys(current, { id: 'new-survey', current_iteration: null })
    expect(result).toHaveLength(20)
    expect(result[0]).toBe('new-survey')
    expect(result).not.toContain('survey-19')
  })
})
