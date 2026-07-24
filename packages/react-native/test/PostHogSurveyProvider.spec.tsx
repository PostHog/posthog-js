/** @jest-environment jsdom */
import React from 'react'
import { act, fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Survey, SurveyType } from '@posthog/core'

// Minimal react-native shim — the full preset pulls in TurboModule code that
// explodes under jsdom. The provider itself renders no RN primitives, but its
// import chain (surveys-utils etc.) touches a few.
jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  const Box = RealReact.forwardRef(({ children, testID, ...rest }: any, ref: any) =>
    RealReact.createElement('div', { ref, 'data-testid': testID, ...rest }, children)
  )
  return {
    View: Box,
    Modal: Box,
    Text: Box,
    Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, absoluteFill: {} },
    Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove: jest.fn() }) },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  }
})

jest.mock('../src/native-deps', () => ({ currentDeviceType: 'Mobile' }))

// Stub the modal: mirror the real behavior (fires onShow once on mount, exposes
// a close hook) without dragging in the SurveyModal render tree.
jest.mock('../src/surveys/components/SurveyModal', () => {
  const R = jest.requireActual('react')
  return {
    SurveyModal: (props: any) => {
      R.useEffect(() => {
        props.onShow()
      }, [])
      return R.createElement('div', {
        'data-testid': 'survey-modal',
        onClick: () => props.onClose(false, {}), // simulate a dismiss (not submitted)
      })
    },
  }
})

// Spy on the shown/dismissed events without executing the real capture path.
jest.mock('../src/surveys/components/Surveys', () => ({
  sendSurveyShownEvent: jest.fn(),
  dismissedSurveyEvent: jest.fn(),
}))

// Skip translation resolution — irrelevant to presentation gating.
jest.mock('../src/surveys/survey-translations', () => ({
  applySurveyTranslationForUser: (survey: Survey) => ({ survey, language: null }),
}))

let mockClient: any
jest.mock('../src/hooks/usePostHog', () => ({ usePostHog: () => mockClient }))

import { PostHogSurveyProvider } from '../src/surveys/PostHogSurveyProvider'
import { sendSurveyShownEvent, dismissedSurveyEvent } from '../src/surveys/components/Surveys'

const popoverSurvey: Survey = {
  id: 's1',
  name: 'S1',
  type: SurveyType.Popover,
  questions: [],
  start_date: '2023-01-01T00:00:00Z',
  end_date: undefined,
  linked_flag_key: undefined,
  targeting_flag_key: undefined,
  internal_targeting_flag_key: undefined,
  feature_flag_keys: [],
  conditions: undefined,
} as unknown as Survey

const makeClient = (surveys: Survey[] = [popoverSurvey]) => ({
  ready: jest.fn(() => Promise.resolve()),
  _onSurveysReady: jest.fn(() => Promise.resolve()),
  getSurveys: jest.fn(() => Promise.resolve(surveys)),
  getFeatureFlags: jest.fn(() => ({})),
  onFeatureFlags: jest.fn(() => () => {}),
  getPersistedProperty: jest.fn(() => undefined),
  setPersistedProperty: jest.fn(),
  capture: jest.fn(),
  on: jest.fn(() => () => {}),
})

const renderProvider = (autoPresentSurveys?: boolean) =>
  render(
    <PostHogSurveyProvider client={mockClient} autoPresentSurveys={autoPresentSurveys}>
      <div data-testid="child" />
    </PostHogSurveyProvider>
  )

// The provider loads surveys via a real-promise chain; the shared jest config
// enables fake timers globally, which deadlocks async act()/waitFor(). This file
// drives no timer-based logic (the modal is stubbed), so real timers are safe.
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('PostHogSurveyProvider — autoPresentSurveys gating', () => {
  beforeEach(() => {
    jest.useRealTimers()
    mockClient = makeClient()
  })
  afterEach(() => {
    cleanup()
    jest.clearAllMocks()
  })

  it('defers presentation while gated: no modal, no "survey shown"', async () => {
    const { queryByTestId } = renderProvider(false)
    await flush()

    expect(queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
  })

  it('presents once the gate flips true, firing "survey shown" exactly once', async () => {
    const { queryByTestId, rerender } = renderProvider(false)
    await flush()
    expect(queryByTestId('survey-modal')).toBeNull()

    rerender(
      <PostHogSurveyProvider client={mockClient} autoPresentSurveys={true}>
        <div data-testid="child" />
      </PostHogSurveyProvider>
    )
    await flush()

    await waitFor(() => expect(queryByTestId('survey-modal')).not.toBeNull())
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('does not interrupt an on-screen survey when the gate flips false', async () => {
    const { queryByTestId, rerender } = renderProvider(true)
    await flush()
    expect(queryByTestId('survey-modal')).not.toBeNull()
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)

    rerender(
      <PostHogSurveyProvider client={mockClient} autoPresentSurveys={false}>
        <div data-testid="child" />
      </PostHogSurveyProvider>
    )
    await flush()

    // Still mounted, and no re-show (no duplicate event).
    expect(queryByTestId('survey-modal')).not.toBeNull()
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('never presents while it stays gated, even across re-renders', async () => {
    const { queryByTestId, rerender } = renderProvider(false)
    await flush()

    for (const on of [false, false, false]) {
      rerender(
        <PostHogSurveyProvider client={mockClient} autoPresentSurveys={on}>
          <div data-testid="child" />
        </PostHogSurveyProvider>
      )
      await flush()
    }

    expect(queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
  })

  it('auto-presents by default (prop omitted) — regression guard', async () => {
    const { queryByTestId } = renderProvider(undefined)
    await flush()

    await waitFor(() => expect(queryByTestId('survey-modal')).not.toBeNull())
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('clears the latch on close so a new gated survey stays deferred', async () => {
    const { queryByTestId, rerender } = renderProvider(true)
    await flush()
    const modal = queryByTestId('survey-modal')
    expect(modal).not.toBeNull()

    // Close the survey, then gate off before the next one could present.
    await act(async () => {
      fireEvent.click(modal!)
      await Promise.resolve()
    })
    expect(dismissedSurveyEvent).toHaveBeenCalledTimes(1)

    rerender(
      <PostHogSurveyProvider client={mockClient} autoPresentSurveys={false}>
        <div data-testid="child" />
      </PostHogSurveyProvider>
    )
    await flush()

    expect(queryByTestId('survey-modal')).toBeNull()
  })
})
