/** @vitest-environment jsdom */
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
    vi.useRealTimers()
    try {
      const ready = Promise.resolve()
      const mockPostHog = {
        ready: vi.fn(() => ready),
        getPersistedProperty: vi.fn((property) =>
          property === PostHogPersistedProperty.SurveysSeen
            ? JSON.stringify(['survey-a', 42, null, 'survey-b'])
            : undefined
        ),
        setPersistedProperty: vi.fn(),
        on: vi.fn(() => () => {}),
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
      vi.useFakeTimers()
    }
  })

  it('clears the last seen survey date when surveys are reset', async () => {
    vi.useRealTimers()
    try {
      const ready = Promise.resolve()
      const storage = new Map<string, unknown>()
      const listeners: Array<() => void> = []
      const mockPostHog = {
        ready: vi.fn(() => ready),
        getPersistedProperty: vi.fn((property) => storage.get(property)),
        setPersistedProperty: vi.fn((property, value) => storage.set(property, value)),
        on: vi.fn((event: string, listener: () => void) => {
          if (event === 'surveysReset') {
            listeners.push(listener)
          }
          return () => {}
        }),
      } as unknown as PostHog
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PostHogContext.Provider, { value: { client: mockPostHog } }, children)

      const { result } = renderHook(() => useSurveyStorage(), { wrapper })
      await act(async () => {
        await ready
      })
      act(() => result.current.setLastSeenSurveyDate(new Date('2026-01-01T00:00:00.000Z')))
      expect(result.current.lastSeenSurveyDate).toEqual(new Date('2026-01-01T00:00:00.000Z'))

      // reset() clears the stored date, then notifies listeners
      storage.delete(PostHogPersistedProperty.SurveyLastSeenDate)
      await act(async () => {
        listeners.forEach((listener) => listener())
        await ready
      })

      expect(result.current.lastSeenSurveyDate).toBeUndefined()
    } finally {
      vi.useFakeTimers()
    }
  })
})
