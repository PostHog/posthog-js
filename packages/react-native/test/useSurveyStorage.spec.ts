/** @jest-environment jsdom */
import { PostHogPersistedProperty } from '@posthog/core'
import { act, renderHook } from '@testing-library/react'
import React from 'react'
import { PostHogContext } from '../src/PostHogContext'
import type { PostHog } from '../src/posthog-rn'
import { updateSeenSurveys, useSurveyStorage } from '../src/surveys/useSurveyStorage'

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

describe('useSurveyStorage', () => {
  it('drops non-string persisted entries before updating seen surveys', async () => {
    jest.useRealTimers()
    try {
      const ready = Promise.resolve()
      const mockPostHog = {
        ready: jest.fn(() => ready),
        getPersistedProperty: jest.fn((property) =>
          property === PostHogPersistedProperty.SurveysSeen
            ? JSON.stringify(['survey-a', 42, null, 'survey-b'])
            : undefined
        ),
        setPersistedProperty: jest.fn(),
      } as unknown as PostHog
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PostHogContext.Provider, { value: { client: mockPostHog } }, children)

      const { result } = renderHook(() => useSurveyStorage(), { wrapper })
      await act(async () => {
        await ready
      })

      expect(result.current.seenSurveys).toEqual(['survey-a', 'survey-b'])
      expect(() => {
        act(() => result.current.setSeenSurvey({ id: 'survey-c', current_iteration: 1 }))
      }).not.toThrow()
      expect(result.current.seenSurveys).toEqual(['survey-c_1', 'survey-a', 'survey-b'])
    } finally {
      jest.useFakeTimers()
    }
  })
})
