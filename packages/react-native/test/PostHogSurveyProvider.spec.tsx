/** @jest-environment jsdom */
import React from 'react'
import { act, render, cleanup } from '@testing-library/react'
import { Survey, SurveyType } from '@posthog/core'
import { PostHogSurveyProvider, sortSurveysByAppearanceDelay } from '../src/surveys/PostHogSurveyProvider'
import * as getActiveMatchingModule from '../src/surveys/getActiveMatchingSurveys'

// Mock react-native primitives as plain divs for jsdom
jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  return {
    View: ({ children, testID }: any) => RealReact.createElement('div', { 'data-testid': testID }, children),
    Modal: ({ children, testID }: any) => RealReact.createElement('div', { 'data-testid': testID }, children),
    KeyboardAvoidingView: ({ children }: any) => RealReact.createElement('div', null, children),
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  }
})

// Stub SurveyModal so we can assert when a survey is rendered
jest.mock('../src/surveys/components/SurveyModal', () => {
  const RealReact = jest.requireActual('react')
  return {
    SurveyModal: ({ survey }: { survey: Survey }) =>
      RealReact.createElement('div', { 'data-testid': `survey-modal-${survey.id}` }, survey.name),
  }
})

// Stub survey translation so it doesn't require deep posthog client methods
jest.mock('../src/surveys/survey-translations', () => ({
  applySurveyTranslationForUser: (survey: Survey) => ({ survey, language: null }),
}))

let mockSurveys: Survey[] = []
const mockFlags: Record<string, any> = {}
const mockSeenSurveys: string[] = []
const mockActivatedSurveys = new Set<string>()

const mockPostHog = {
  ready: jest.fn(() => Promise.resolve()),
  _onSurveysReady: jest.fn(() => Promise.resolve()),
  getSurveys: jest.fn(() => Promise.resolve(mockSurveys)),
} as any

jest.mock('../src/hooks/usePostHog', () => ({
  usePostHog: () => mockPostHog,
}))

jest.mock('../src/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => mockFlags,
}))

jest.mock('../src/surveys/useSurveyStorage', () => ({
  useSurveyStorage: () => ({
    seenSurveys: mockSeenSurveys,
    setSeenSurvey: jest.fn(),
    lastSeenSurveyDate: undefined,
    setLastSeenSurveyDate: jest.fn(),
  }),
}))

jest.mock('../src/surveys/useActivatedSurveys', () => ({
  useActivatedSurveys: () => mockActivatedSurveys,
}))

const createMockSurvey = (id: string, delaySeconds?: number): Survey => ({
  id,
  name: `Survey ${id}`,
  type: SurveyType.Popover,
  questions: [],
  start_date: '2023-01-01T00:00:00Z',
  appearance: delaySeconds !== undefined ? { surveyPopupDelaySeconds: delaySeconds } : {},
})

describe('Issue #3193: Survey popup delay (surveyPopupDelaySeconds)', () => {
  afterEach(() => {
    cleanup()
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  describe('sortSurveysByAppearanceDelay', () => {
    it('sorts surveys in ascending order of delay (shorter delays first)', () => {
      const surveys: Survey[] = [createMockSurvey('s1', 10), createMockSurvey('s2', 2), createMockSurvey('s3', 5)]

      const sorted = sortSurveysByAppearanceDelay(surveys)
      expect(sorted.map((s) => s.id)).toEqual(['s2', 's3', 's1'])
    })

    it('defaults missing appearance or missing surveyPopupDelaySeconds to 0 (shown first)', () => {
      const surveys: Survey[] = [
        createMockSurvey('delayed', 5),
        { id: 'no-delay', name: 'No delay', type: SurveyType.Popover, questions: [] } as Survey,
        createMockSurvey('zero-delay', 0),
      ]

      const sorted = sortSurveysByAppearanceDelay(surveys)
      expect(sorted[0].id).toMatch(/no-delay|zero-delay/)
      expect(sorted[1].id).toMatch(/no-delay|zero-delay/)
      expect(sorted[2].id).toBe('delayed')
    })

    it('does not mutate the input array', () => {
      const surveys = [createMockSurvey('b', 5), createMockSurvey('a', 1)]
      const copy = [...surveys]

      sortSurveysByAppearanceDelay(surveys)
      expect(surveys).toEqual(copy)
    })
  })

  describe('PostHogSurveyProvider delay and condition re-check', () => {
    it('shows survey immediately when surveyPopupDelaySeconds is 0 or undefined', () => {
      const survey = createMockSurvey('immediate-survey', 0)
      mockSurveys = [survey]
      mockPostHog.getSurveys.mockResolvedValue([survey])

      const { queryByTestId } = render(
        <PostHogSurveyProvider client={mockPostHog}>
          <div>App Content</div>
        </PostHogSurveyProvider>
      )

      act(() => {
        jest.runAllTimers()
      })

      expect(queryByTestId('survey-modal-immediate-survey')).toBeTruthy()
    })

    it('delays showing the survey popup by surveyPopupDelaySeconds', () => {
      const delaySeconds = 5
      const survey = createMockSurvey('delayed-survey', delaySeconds)
      mockSurveys = [survey]
      mockPostHog.getSurveys.mockResolvedValue([survey])

      const { queryByTestId } = render(
        <PostHogSurveyProvider client={mockPostHog}>
          <div>App Content</div>
        </PostHogSurveyProvider>
      )

      // Resolve initial mount & survey loading
      act(() => {
        jest.advanceTimersByTime(0)
      })

      // At t = 0, popup should NOT be shown
      expect(queryByTestId('survey-modal-delayed-survey')).toBeNull()

      // At t = 4s (before delay), still NOT shown
      act(() => {
        jest.advanceTimersByTime(4000)
      })
      expect(queryByTestId('survey-modal-delayed-survey')).toBeNull()

      // At t = 5s (delay elapsed), popup IS shown
      act(() => {
        jest.advanceTimersByTime(1000)
      })
      expect(queryByTestId('survey-modal-delayed-survey')).toBeTruthy()
    })

    it('shows the survey with the shortest delay first when multiple surveys match', () => {
      const longDelay = createMockSurvey('long-delay', 10)
      const shortDelay = createMockSurvey('short-delay', 3)
      mockSurveys = [longDelay, shortDelay]
      mockPostHog.getSurveys.mockResolvedValue([longDelay, shortDelay])

      const { queryByTestId } = render(
        <PostHogSurveyProvider client={mockPostHog}>
          <div>App Content</div>
        </PostHogSurveyProvider>
      )

      // Resolve initial mount
      act(() => {
        jest.advanceTimersByTime(0)
      })

      // Advance by 3s (short delay)
      act(() => {
        jest.advanceTimersByTime(3000)
      })

      expect(queryByTestId('survey-modal-short-delay')).toBeTruthy()
      expect(queryByTestId('survey-modal-long-delay')).toBeNull()
    })

    it('re-checks conditions after delay and does NOT display if conditions no longer match', () => {
      const survey = createMockSurvey('conditional-survey', 5)
      mockSurveys = [survey]
      mockPostHog.getSurveys.mockResolvedValue([survey])

      const getActiveSpy = jest.spyOn(getActiveMatchingModule, 'getActiveMatchingSurveys')

      const { queryByTestId } = render(
        <PostHogSurveyProvider client={mockPostHog}>
          <div>App Content</div>
        </PostHogSurveyProvider>
      )

      // Resolve initial mount
      act(() => {
        jest.advanceTimersByTime(0)
      })

      // Conditions change during the 5s delay
      getActiveSpy.mockReturnValue([])

      // Advance timer past the 5-second delay
      act(() => {
        jest.advanceTimersByTime(5000)
      })

      expect(queryByTestId('survey-modal-conditional-survey')).toBeNull()
      getActiveSpy.mockRestore()
    })

    it('clears pending timeout when provider unmounts', () => {
      const survey = createMockSurvey('unmount-survey', 5)
      mockSurveys = [survey]
      mockPostHog.getSurveys.mockResolvedValue([survey])

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')

      const { unmount } = render(
        <PostHogSurveyProvider client={mockPostHog}>
          <div>App Content</div>
        </PostHogSurveyProvider>
      )

      // Resolve survey loading
      act(() => {
        jest.advanceTimersByTime(0)
      })

      act(() => {
        unmount()
      })

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })
  })
})
