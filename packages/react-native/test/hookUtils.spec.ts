/** @jest-environment jsdom */
import { warnIfNoClient, resetWarnedCallers } from '../src/hooks/utils'
import type { PostHog } from '../src/posthog-rn'

describe('warnIfNoClient', () => {
  afterEach(() => {
    resetWarnedCallers()
  })

  it('should log error when client is undefined', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    warnIfNoClient(undefined, 'useFeatureFlag')

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('useFeatureFlag was called without a PostHog client')
    )
    consoleErrorSpy.mockRestore()
  })

  it('should not log error when a valid client is provided', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const mockPostHog = {} as PostHog

    warnIfNoClient(mockPostHog, 'useFeatureFlag')

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('should only warn once per caller', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    warnIfNoClient(undefined, 'useFeatureFlag')
    warnIfNoClient(undefined, 'useFeatureFlag')

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    consoleErrorSpy.mockRestore()
  })

  it('should warn independently for different callers', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    warnIfNoClient(undefined, 'useFeatureFlag')
    warnIfNoClient(undefined, 'usePostHog')

    expect(consoleErrorSpy).toHaveBeenCalledTimes(2)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('useFeatureFlag was called without a PostHog client')
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('usePostHog was called without a PostHog client')
    )
    consoleErrorSpy.mockRestore()
  })
})
