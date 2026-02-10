/** @jest-environment jsdom */
import React from 'react'
import { renderHook } from '@testing-library/react'
import { PostHogContext } from '../src/PostHogContext'
import { useOptionalPostHog, validatePostHogClient } from '../src/hooks/useOptionalPostHog'
import type { PostHog } from '../src/posthog-rn'

describe('useOptionalPostHog', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should return undefined when used outside a provider', () => {
    const { result } = renderHook(() => useOptionalPostHog())

    expect(result.current).toBeUndefined()
  })

  it('should return the client from context', () => {
    const mockPostHog = {} as PostHog
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(PostHogContext.Provider, { value: { client: mockPostHog } }, children)

    const { result } = renderHook(() => useOptionalPostHog(), { wrapper })

    expect(result.current).toBe(mockPostHog)
  })
})

describe('validatePostHogClient', () => {
  it('should throw with caller name when client is undefined and caller is provided', () => {
    expect(() => validatePostHogClient(undefined, 'useFeatureFlag')).toThrow(
      'useFeatureFlag requires a PostHog client provided as an argument or via context.'
    )
  })

  it('should throw with generic message when client is undefined and no caller is provided', () => {
    expect(() => validatePostHogClient(undefined)).toThrow(
      'This hook requires a PostHog client provided as an argument or via context.'
    )
  })

  it('should not throw when a valid client is provided', () => {
    const mockPostHog = {} as PostHog
    expect(() => validatePostHogClient(mockPostHog)).not.toThrow()
  })
})
