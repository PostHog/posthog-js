/** @vitest-environment jsdom */
import React from 'react'
import { act, fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { PostHogPersistedProperty, Survey, SurveyQuestionType, SurveyType } from '@posthog/core'

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
    StyleSheet: {
      create: (s: any) => s,
      flatten: (s: any) => s,
      absoluteFill: {},
    },
    Appearance: {
      getColorScheme: () => 'light',
      addChangeListener: () => ({ remove: vi.fn() }),
    },
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
        'data-survey-id': props.survey.id,
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
  applySurveyTranslationForUser: (survey: Survey) => ({
    survey,
    language: null,
  }),
}))

let mockClient: any
vi.mock('../src/hooks/usePostHog', () => ({ usePostHog: () => mockClient }))

import { createSurveyProgress, SurveyProgressStore } from '../src/surveys/survey-progress'
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

const makeClient = (surveys: Survey[] = [popoverSurvey]) => {
  const storage = new Map<string, unknown>([[PostHogPersistedProperty.Surveys, surveys]])
  return {
    apiKey: 'test-project',
    ready: vi.fn(() => Promise.resolve()),
    _onSurveysReady: vi.fn(() => Promise.resolve()),
    getSurveys: vi.fn(() => Promise.resolve(surveys)),
    getFeatureFlags: vi.fn(() => ({})),
    onFeatureFlags: vi.fn(() => () => {}),
    getPersistedProperty: vi.fn((key: string) => storage.get(key)),
    setPersistedProperty: vi.fn((key: string, value: unknown) => storage.set(key, value)),
    capture: vi.fn(),
    on: vi.fn(() => () => {}),
  }
}

const renderProvider = (autoPresentSurveys?: boolean) =>
  render(
    <PostHogSurveyProvider client={mockClient} autoPresentSurveys={autoPresentSurveys}>
      <div data-testid="child" />
    </PostHogSurveyProvider>
  )

// The provider loads surveys via a real-promise chain; the shared vi config
// enables fake timers globally, which deadlocks async act()/waitFor(). This file
// uses real timers for the original gating tests; delay tests below use their own fake-timer helper.
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
    const flaggedSurvey = {
      ...popoverSurvey,
      id: 's-flag',
      linked_flag_key: 'f1',
    } as unknown as Survey
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

describe('PostHogSurveyProvider — seenSurveyWaitPeriodInDays', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  const waitPeriodSurvey = {
    ...popoverSurvey,
    id: 's-wait',
    conditions: { seenSurveyWaitPeriodInDays: 7 },
  } as unknown as Survey

  const clientWithLastSeen = (surveys: Survey[], lastSeen: Date) => ({
    ...makeClient(surveys),
    getPersistedProperty: vi.fn((key: string) =>
      key === 'survey_last_seen_date' ? lastSeen.toISOString() : undefined
    ),
  })

  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('does not present a survey when another survey was seen within the wait period', async () => {
    mockClient = clientWithLastSeen([waitPeriodSurvey], new Date(Date.now() - 2 * DAY_MS))
    const { queryByTestId } = renderProvider(true)
    await flush()

    expect(queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
  })

  it('presents the survey once the wait period has passed', async () => {
    mockClient = clientWithLastSeen([waitPeriodSurvey], new Date(Date.now() - 10 * DAY_MS))
    const { queryByTestId } = renderProvider(true)
    await flush()

    await waitFor(() => expect(queryByTestId('survey-modal')).not.toBeNull())
  })

  it('does not present a wait-period survey right after another survey is closed', async () => {
    const otherSurvey = { ...popoverSurvey, id: 's-other' } as unknown as Survey
    mockClient = makeClient([otherSurvey, waitPeriodSurvey])
    const { queryByTestId } = renderProvider(true)
    await flush()
    expect(sendSurveyShownEvent).toHaveBeenLastCalledWith(expect.objectContaining({ id: 's-other' }), mockClient, null)

    await act(async () => {
      fireEvent.click(queryByTestId('survey-modal')!)
      await Promise.resolve()
    })
    await flush()

    expect(sendSurveyShownEvent).not.toHaveBeenCalledWith(expect.objectContaining({ id: 's-wait' }), mockClient, null)
    expect(queryByTestId('survey-modal')).toBeNull()
  })
})

describe('PostHogSurveyProvider — popup delay', () => {
  const delayedSurvey = (id: string, delay?: number): Survey => ({
    ...popoverSurvey,
    id,
    appearance: { surveyPopupDelaySeconds: delay },
    questions: [{ id: 'q1', type: SurveyQuestionType.Open, question: 'Feedback?' }],
  })
  const loadSurveys = async () => {
    // Flush the provider's readiness promises without advancing the appearance delay.
    await act(async () => {})
  }
  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }
  const setFlags = (flags: Record<string, boolean>) => {
    const callback = mockClient.onFeatureFlags.mock.calls[0][0]
    act(() => callback(flags))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockClient = makeClient()
  })
  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it.each([undefined, 0, -1])('shows immediately for delay %s', async (delay) => {
    mockClient = makeClient([delayedSurvey('immediate', delay)])
    const view = renderProvider()
    await loadSurveys()
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('immediate')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it.each([
    { remote: 10, local: 0, override: true, expected: 0 },
    { remote: 10, local: 2, override: true, expected: 2 },
    { remote: 10, local: 2, override: false, expected: 10 },
    { remote: undefined, local: 2, override: false, expected: 2 },
    { remote: 0, local: 2, override: false, expected: 0 },
    { remote: undefined, local: undefined, override: false, expected: 0 },
  ])(
    'uses delay $expected with remote=$remote, local=$local, override=$override',
    async ({ remote, local, override, expected }) => {
      mockClient = makeClient([delayedSurvey('precedence', remote)])
      const view = render(
        <PostHogSurveyProvider
          client={mockClient}
          defaultSurveyAppearance={{ surveyPopupDelaySeconds: local }}
          overrideAppearanceWithDefault={override}
        >
          <div />
        </PostHogSurveyProvider>
      )
      await loadSurveys()
      if (expected > 0) {
        await advance(expected * 1000 - 1)
        expect(view.queryByTestId('survey-modal')).toBeNull()
        expect(sendSurveyShownEvent).not.toHaveBeenCalled()
        await advance(1)
      }
      expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('precedence')
      expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
    }
  )

  it('ignores remote delays when ordering candidates with appearance overrides enabled', async () => {
    mockClient = makeClient([delayedSurvey('first', 10), delayedSurvey('second', 1)])
    const view = render(
      <PostHogSurveyProvider
        client={mockClient}
        defaultSurveyAppearance={{ surveyPopupDelaySeconds: 0 }}
        overrideAppearanceWithDefault
      >
        <div />
      </PostHogSurveyProvider>
    )
    await loadSurveys()
    // Both effective delays are zero, so preserve their original order.
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('first')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('orders candidates using the local fallback delay', async () => {
    mockClient = makeClient([delayedSurvey('fallback'), delayedSurvey('explicit', 1)])
    const view = render(
      <PostHogSurveyProvider client={mockClient} defaultSurveyAppearance={{ surveyPopupDelaySeconds: 10 }}>
        <div />
      </PostHogSurveyProvider>
    )
    await loadSurveys()
    await advance(999)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('explicit')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('preserves the first deadline when the qualifying event repeats', async () => {
    mockClient = makeClient([
      { ...delayedSurvey('triggered', 10), conditions: { events: { values: [{ name: 'add_to_cart' }] } } },
    ])
    const view = renderProvider()
    await loadSurveys()
    const capture = mockClient.on.mock.calls.find(([name]: [string]) => name === 'capture')[1]
    act(() => capture({ event: 'add_to_cart' }))
    await advance(4000)
    act(() => capture({ event: 'add_to_cart' }))
    await advance(4000)
    act(() => capture({ event: 'add_to_cart' }))
    await advance(1999)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    expect(mockClient.setPersistedProperty).not.toHaveBeenCalledWith(
      PostHogPersistedProperty.SurveyLastSeenDate,
      expect.anything()
    )
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('triggered')
    await advance(10000)
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('preserves the pending deadline across unrelated flag updates', async () => {
    mockClient = makeClient([delayedSurvey('pending', 10)])
    const view = renderProvider()
    await loadSurveys()
    await advance(4000)
    setFlags({ unrelated: true })
    await advance(4000)
    setFlags({ unrelated: false })
    await advance(1999)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('pending')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('preserves the pending deadline across equivalent inline appearances', async () => {
    mockClient = makeClient([delayedSurvey('pending')])
    const provider = () => (
      <PostHogSurveyProvider client={mockClient} defaultSurveyAppearance={{ surveyPopupDelaySeconds: 10 }}>
        <div />
      </PostHogSurveyProvider>
    )
    const view = render(provider())
    await loadSurveys()
    await advance(4000)
    view.rerender(provider())
    await advance(4000)
    view.rerender(provider())
    await advance(1999)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('pending')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it.each([0, 12])('applies a changed local delay of %s seconds from the original selection', async (delay) => {
    mockClient = makeClient([delayedSurvey('pending')])
    const provider = (seconds: number) => (
      <PostHogSurveyProvider client={mockClient} defaultSurveyAppearance={{ surveyPopupDelaySeconds: seconds }}>
        <div />
      </PostHogSurveyProvider>
    )
    const view = render(provider(10))
    await loadSurveys()
    await advance(4000)
    view.rerender(provider(delay))
    if (delay > 0) {
      await advance(delay * 1000 - 4001)
      expect(view.queryByTestId('survey-modal')).toBeNull()
      await advance(1)
    }
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('pending')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('keeps a pending reservation when a shorter-delay candidate becomes eligible', async () => {
    mockClient = makeClient([
      delayedSurvey('pending', 10),
      { ...delayedSurvey('new', 0), targeting_flag_key: 'new-eligible' },
    ])
    const view = renderProvider()
    await loadSurveys()
    await advance(4000)
    setFlags({ 'new-eligible': true })
    expect(view.queryByTestId('survey-modal')).toBeNull()
    await advance(6000)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('pending')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it('starts a new delay after the pending survey loses and regains eligibility', async () => {
    mockClient = makeClient([{ ...delayedSurvey('pending', 10), targeting_flag_key: 'eligible' }])
    mockClient.getFeatureFlags.mockReturnValue({ eligible: true })
    const view = renderProvider()
    await loadSurveys()
    await advance(4000)
    setFlags({ eligible: false })
    await advance(4000)
    setFlags({ eligible: true })
    await advance(9999)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('pending')
  })

  it('releases a pending reservation on reset and waits for a new trigger', async () => {
    mockClient = makeClient([
      { ...delayedSurvey('triggered', 10), conditions: { events: { values: [{ name: 'trigger' }] } } },
    ])
    const view = renderProvider()
    await loadSurveys()
    const capture = mockClient.on.mock.calls.find(([name]: [string]) => name === 'capture')[1]
    act(() => capture({ event: 'trigger' }))
    await advance(4000)
    act(() => {
      for (const [event, callback] of mockClient.on.mock.calls) {
        if (event === 'surveysReset') callback()
      }
    })
    await loadSurveys()
    await advance(10000)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    expect(dismissedSurveyEvent).not.toHaveBeenCalled()
    act(() => capture({ event: 'trigger' }))
    await advance(9999)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('triggered')
  })

  it('starts a fresh countdown when the client changes', async () => {
    const survey = delayedSurvey('pending', 10)
    mockClient = makeClient([survey])
    const view = renderProvider()
    await loadSurveys()
    await advance(4000)
    mockClient = makeClient([survey])
    view.rerender(
      <PostHogSurveyProvider client={mockClient}>
        <div />
      </PostHogSurveyProvider>
    )
    await loadSurveys()
    await advance(9999)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('pending')
    expect(sendSurveyShownEvent).toHaveBeenCalledWith(survey, mockClient, null)
  })

  it('waits the full delay and chooses the shortest delay without mutating the definitions', async () => {
    const surveys = [delayedSurvey('slow', 10), delayedSurvey('fast', 2)]
    mockClient = makeClient(surveys)
    const view = renderProvider()
    await loadSurveys()
    expect(view.queryByTestId('survey-modal')).toBeNull()
    await advance(1999)
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('fast')
    expect(surveys.map((survey) => survey.id)).toEqual(['slow', 'fast'])
  })

  it('cancels a pending survey when its targeting flag turns off', async () => {
    mockClient = makeClient([{ ...delayedSurvey('flagged', 5), targeting_flag_key: 'eligible' }])
    mockClient.getFeatureFlags.mockReturnValue({ eligible: true })
    const view = renderProvider()
    await loadSurveys()
    await advance(2000)
    setFlags({ eligible: false })
    await advance(5000)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
  })

  it('clears an ineligible armed survey before waiting for its replacement', async () => {
    mockClient = makeClient([
      { ...delayedSurvey('old', 1), targeting_flag_key: 'old-eligible' },
      delayedSurvey('replacement', 5),
    ])
    mockClient.getFeatureFlags.mockReturnValue({ 'old-eligible': true })
    const view = renderProvider(false)
    await loadSurveys()
    await advance(1000)
    expect(view.queryByTestId('survey-modal')).toBeNull()

    setFlags({ 'old-eligible': false })
    view.rerender(
      <PostHogSurveyProvider client={mockClient} autoPresentSurveys={true}>
        <div />
      </PostHogSurveyProvider>
    )
    expect(view.queryByTestId('survey-modal')).toBeNull()
    await advance(4999)
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    await advance(1)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('replacement')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
    expect(sendSurveyShownEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'replacement' }), mockClient, null)
  })

  it('preserves an eligible armed survey when another candidate becomes eligible', async () => {
    mockClient = makeClient([
      delayedSurvey('armed', 1),
      { ...delayedSurvey('new', 0), targeting_flag_key: 'new-eligible' },
    ])
    const view = renderProvider(false)
    await loadSurveys()
    await advance(1000)
    setFlags({ 'new-eligible': true })
    view.rerender(
      <PostHogSurveyProvider client={mockClient} autoPresentSurveys={true}>
        <div />
      </PostHogSurveyProvider>
    )
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('armed')
  })

  it('does not interrupt a shown survey when its targeting flag turns off', async () => {
    mockClient = makeClient([
      { ...delayedSurvey('shown', 1), targeting_flag_key: 'eligible' },
      delayedSurvey('replacement', 5),
    ])
    mockClient.getFeatureFlags.mockReturnValue({ eligible: true })
    const view = renderProvider()
    await loadSurveys()
    await advance(1000)
    setFlags({ eligible: false })
    await advance(5000)
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('shown')
    expect(sendSurveyShownEvent).toHaveBeenCalledTimes(1)
  })

  it.each([0, 5])('resumes saved event-targeted progress before a new zero-delay survey (delay=%s)', async (delay) => {
    const resumed: Survey = {
      ...delayedSurvey('resumed', delay),
      internal_targeting_flag_key: 'consumed',
      conditions: { events: { values: [{ name: 'trigger' }] } },
      questions: [{ id: 'q1', type: SurveyQuestionType.Open, question: 'Feedback?' }],
    }
    mockClient = makeClient([delayedSurvey('new', 0), resumed])
    const progress = createSurveyProgress(resumed)
    new SurveyProgressStore(mockClient).save(resumed, progress)
    const view = renderProvider()
    await loadSurveys()
    if (delay > 0) {
      await advance(delay * 1000 - 1)
      expect(view.queryByTestId('survey-modal')).toBeNull()
      await advance(1)
    }
    expect(view.getByTestId('survey-modal').getAttribute('data-survey-id')).toBe('resumed')
    expect(mockClient.capture).not.toHaveBeenCalled()
  })

  it('does not schedule a delayed survey during its cooldown', async () => {
    const survey = { ...delayedSurvey('cooldown', 5), conditions: { seenSurveyWaitPeriodInDays: 1 } }
    mockClient = makeClient([survey])
    mockClient.setPersistedProperty(
      PostHogPersistedProperty.SurveyLastSeenDate,
      new Date(Date.now() - 60000).toISOString()
    )
    const view = renderProvider()
    await loadSurveys()
    await advance(5000)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
  })

  it('does not show a pending survey if the client opts out during the delay', async () => {
    mockClient = makeClient([delayedSurvey('pending', 5)])
    const view = renderProvider()
    await loadSurveys()
    await advance(2000)
    mockClient.optedOut = true
    await advance(3000)
    expect(view.queryByTestId('survey-modal')).toBeNull()
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
    expect(dismissedSurveyEvent).not.toHaveBeenCalled()
    expect(mockClient.setPersistedProperty).not.toHaveBeenCalledWith(
      PostHogPersistedProperty.SurveyLastSeenDate,
      expect.anything()
    )
  })

  it('cancels the appearance timer on unmount', async () => {
    mockClient = makeClient([delayedSurvey('pending', 5)])
    const view = renderProvider()
    await loadSurveys()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    await advance(5000)
    expect(sendSurveyShownEvent).not.toHaveBeenCalled()
  })
})
