/** @vitest-environment jsdom */
import React from 'react'
import { act, fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Survey, SurveyType } from '@posthog/core'

// Minimal react-native shim — the full preset pulls in TurboModule code that
// explodes under jsdom. The provider itself renders no RN primitives, but its
// import chain (surveys-utils etc.) touches a few.
vi.mock('react-native', async () => {
  const RealReact = await vi.importActual<typeof import('react')>('react')
  const Box = RealReact.forwardRef(({ children, testID, ...rest }: any, ref: any) =>
    RealReact.createElement('div', { ref, 'data-testid': testID, ...rest }, children)
  )
  return {
    View: Box,
    Modal: Box,
    Text: Box,
    Platform: { OS: 'android', select: (o: any) => o.android ?? o.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, absoluteFill: {} },
    Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove: vi.fn() }) },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  }
})

vi.mock('../src/native-deps', () => ({ currentDeviceType: 'Mobile' }))

// Stub the modal: mirror the real behavior (fires onShow once on mount, exposes
// a close hook) without dragging in the SurveyModal render tree.
vi.mock('../src/surveys/components/SurveyModal', async () => {
  const R = await vi.importActual<typeof import('react')>('react')
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
vi.mock('../src/surveys/components/Surveys', () => ({
  sendSurveyShownEvent: vi.fn(),
  dismissedSurveyEvent: vi.fn(),
}))

// Skip translation resolution — irrelevant to presentation gating.
vi.mock('../src/surveys/survey-translations', () => ({
  detectUserLanguage: () => null,
  applySurveyTranslationForUser: (survey: Survey) => ({ survey, language: null }),
}))

let mockClient: any
vi.mock('../src/hooks/usePostHog', () => ({ usePostHog: () => mockClient }))

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
  ready: vi.fn(() => Promise.resolve()),
  _onSurveysReady: vi.fn(() => Promise.resolve()),
  getSurveys: vi.fn(() => Promise.resolve(surveys)),
  getFeatureFlags: vi.fn(() => ({})),
  onFeatureFlags: vi.fn(() => () => {}),
  getPersistedProperty: vi.fn(() => undefined),
  setPersistedProperty: vi.fn(),
  capture: vi.fn(),
  on: vi.fn(() => () => {}),
})

const renderProvider = (autoPresentSurveys?: boolean) =>
  render(
    <PostHogSurveyProvider client={mockClient} autoPresentSurveys={autoPresentSurveys}>
      <div data-testid="child" />
    </PostHogSurveyProvider>
  )

// The provider loads surveys via a real-promise chain; the shared vi config
// enables fake timers globally, which deadlocks async act()/waitFor(). This file
// drives no timer-based logic (the modal is stubbed), so real timers are safe.
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('PostHogSurveyProvider — autoPresentSurveys gating', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mockClient = makeClient()
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
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

  it('re-validates a deferred survey: does not present one that became ineligible mid-deferral', async () => {
    let flags: Record<string, any> = { f1: true }
    let flagCb: ((f: any) => void) | undefined
    const flaggedSurvey = { ...popoverSurvey, id: 's-flag', linked_flag_key: 'f1' } as unknown as Survey
    mockClient = {
      ...makeClient([flaggedSurvey]),
      getFeatureFlags: vi.fn(() => flags),
      onFeatureFlags: vi.fn((cb: any) => {
        flagCb = cb
        return () => {}
      }),
    }

    // Armed while eligible, but deferred (gate off) so it never paints.
    const { queryByTestId, rerender } = renderProvider(false)
    await flush()
    expect(queryByTestId('survey-modal')).toBeNull()

    // Its linked flag flips off during the deferral window.
    await act(async () => {
      flags = {}
      flagCb?.({})
    })

    // Un-defer: the survey no longer matches, so nothing is presented.
    rerender(
      <PostHogSurveyProvider client={mockClient} autoPresentSurveys={true}>
        <div data-testid="child" />
      </PostHogSurveyProvider>
    )
    await flush()

    expect(queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
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
