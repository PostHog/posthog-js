/** @jest-environment jsdom */
import React from 'react'
import { renderHook } from '@testing-library/react'
import { PostHogContext } from '../src/PostHogContext'
import { usePostHog } from '../src/hooks/usePostHog'
import type { PostHog } from '../src/posthog-rn'

describe('usePostHog', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should return the client from context', () => {
    const mockPostHog = {} as PostHog
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(PostHogContext.Provider, { value: { client: mockPostHog } }, children)

    const { result } = renderHook(() => usePostHog(), { wrapper })

    expect(result.current).toBe(mockPostHog)
  })

  it('should throw when used outside a PostHogProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => usePostHog())).toThrow('usePostHog must be used within a PostHogProvider')
  })
})
