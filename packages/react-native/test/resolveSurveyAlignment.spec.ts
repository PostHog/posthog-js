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

  it('falls back to the Center default when position is undefined', () => {
    expect(resolveSurveyAlignment(undefined)).toEqual({ vertical: 'flex-end', horizontal: 'center' })
  })

  it('warns once and falls back to the default for unknown position strings', () => {
    // Module-scope dedup of warned positions persists across tests, so use a
    // unique unknown string per run to avoid coupling to other tests' state.
    const unknown = `unknown-${Math.random().toString(36).slice(2)}`
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = resolveSurveyAlignment(unknown)
      expect(result).toEqual({ vertical: 'flex-end', horizontal: 'center' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain(unknown)
      // Calling again with the same unknown string does not re-warn.
      resolveSurveyAlignment(unknown)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
