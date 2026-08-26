import { SurveyPosition } from '@posthog/core'
import { resolveSurveyAlignment } from '../src/surveys/surveys-utils'

describe('resolveSurveyAlignment', () => {
  it.each([
    [SurveyPosition.TopLeft, 'flex-start', 'flex-start'],
    [SurveyPosition.TopCenter, 'flex-start', 'center'],
    [SurveyPosition.TopRight, 'flex-start', 'flex-end'],
    [SurveyPosition.MiddleLeft, 'center', 'flex-start'],
    [SurveyPosition.MiddleCenter, 'center', 'center'],
    [SurveyPosition.MiddleRight, 'center', 'flex-end'],
    [SurveyPosition.Left, 'flex-end', 'flex-start'],
    [SurveyPosition.Center, 'flex-end', 'center'],
    [SurveyPosition.Right, 'flex-end', 'flex-end'],
  ])('maps %s to vertical=%s, horizontal=%s', (position, vertical, horizontal) => {
    expect(resolveSurveyAlignment(position)).toEqual({ vertical, horizontal })
  })

  it.each([
    ['bottom-left', 'flex-end', 'flex-start'],
    ['bottom-center', 'flex-end', 'center'],
    ['bottom-right', 'flex-end', 'flex-end'],
    ['top-right', 'flex-start', 'flex-end'],
    ['middle-left', 'center', 'flex-start'],
  ])('maps compatible position %s to vertical=%s, horizontal=%s', (position, vertical, horizontal) => {
    expect(resolveSurveyAlignment(position)).toEqual({ vertical, horizontal })
  })

  it('falls back to the Center default when position is undefined', () => {
    expect(resolveSurveyAlignment(undefined)).toEqual({ vertical: 'flex-end', horizontal: 'center' })
  })

  it('warns and falls back to the default for non-string positions', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = resolveSurveyAlignment(42 as unknown as string)
      expect(result).toEqual({ vertical: 'flex-end', horizontal: 'center' })
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('warns once for unknown positions that normalize to the same value', () => {
    // Module-scope dedup of warned positions persists across tests, so use a
    // unique unknown string per run to avoid coupling to other tests' state.
    const suffix = Math.random().toString(36).slice(2)
    const unknownWithHyphen = `unknown-${suffix}`
    const unknownWithUnderscore = `unknown_${suffix}`
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = resolveSurveyAlignment(unknownWithHyphen)
      expect(result).toEqual({ vertical: 'flex-end', horizontal: 'center' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain(unknownWithHyphen)
      resolveSurveyAlignment(unknownWithUnderscore)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
