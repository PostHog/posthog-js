/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { PostHogPersistedProperty, Survey, SurveyQuestion, SurveyQuestionType, SurveyType } from '@posthog/core'
import { createEventsStorage } from '../src/storage'
import { PostHogSurveyProvider } from '../src/surveys/PostHogSurveyProvider'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'
import type { PostHog } from '../src/posthog-rn'

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

let client: any
let lastModalProps: any
vi.mock('../src/hooks/usePostHog', () => ({ usePostHog: () => client }))
vi.mock('../src/surveys/components/QuestionTypes', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Question = ({ question, onSubmit }: { question: SurveyQuestion; onSubmit: (answer: string) => void }) =>
    React.createElement('button', { onClick: () => onSubmit('answer-' + question.id) }, question.id)
  return {
    OpenTextQuestion: Question,
    LinkQuestion: Question,
    RatingQuestion: Question,
    MultipleChoiceQuestion: Question,
  }
})
vi.mock('../src/surveys/components/SurveyModal', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const { Questions } = await import('../src/surveys/components/Surveys')
  return {
    SurveyModal: (props: any) => {
      lastModalProps = props
      const [responses, setResponses] = React.useState(props.initialProgress.responses)
      const [completed, setCompleted] = React.useState(false)
      React.useEffect(() => {
        props.onShow()
      }, [props.onShow])
      return React.createElement(
        React.Fragment,
        null,
        completed
          ? React.createElement('span', null, 'Thank you')
          : React.createElement(Questions, {
              ...props,
              appearance: defaultSurveyAppearance,
              onResponsesChange: setResponses,
              onSubmit: () => setCompleted(true),
            }),
        React.createElement('button', { onClick: () => props.onClose(completed, responses) }, 'Close')
      )
    },
  }
})

const survey = {
  id: 'resume',
  name: 'Resume',
  type: SurveyType.Popover,
  start_date: '2026-01-01',
  enable_partial_responses: true,
  internal_targeting_flag_key: 'eligible',
  conditions: { events: { values: [{ name: 'trigger' }] } },
  questions: ['q1', 'q2'].map((id, originalQuestionIndex) => ({
    id,
    originalQuestionIndex,
    type: SurveyQuestionType.Open,
    question: id,
  })),
} as Survey

function makeClient(disk: Map<string, string>, surveys = [survey], flags = { eligible: true }) {
  const storage = createEventsStorage({
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => {
      disk.set(key, value)
    },
  })
  const listeners = new Map<string, Set<(value: any) => void>>()
  const emit = (event: string, payload?: unknown) => listeners.get(event)?.forEach((listener) => listener(payload))
  const sdk = {
    apiKey: 'project',
    optedOut: false,
    ready: async () => {
      await storage.preloadPromise
    },
    _onSurveysReady: async () => {},
    getSurveys: async () => surveys,
    getFeatureFlags: () => flags,
    onFeatureFlags: () => () => {},
    getPersistedProperty: (key: PostHogPersistedProperty) => storage.getItem(key),
    setPersistedProperty: (key: PostHogPersistedProperty, value: unknown) => storage.setItem(key, value),
    getCommonEventProperties: () => ({}),
    getSurveyDisplayLanguageOverride: () => null,
    capture: vi.fn((event, properties) => emit('capture', { event, properties })),
    on: (event: string, listener: (value: any) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => {
        set.delete(listener)
      }
    },
    resetSurveyState: () => {
      storage.removeItem(PostHogPersistedProperty.SurveysInProgress)
      storage.removeItem(PostHogPersistedProperty.SurveysSeen)
      emit('surveysReset')
    },
    storage,
  }
  return sdk
}

const mount = () =>
  render(
    <PostHogSurveyProvider client={client as PostHog}>
      <span>App</span>
    </PostHogSurveyProvider>
  )
const ready = async () => {
  await act(async () => {
    await client.ready()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
beforeEach(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it.each([true, false])('resumes after a fresh SDK/provider without retriggering (partial=%s)', async (partial) => {
  const configured = { ...survey, enable_partial_responses: partial }
  const disk = new Map<string, string>()
  client = makeClient(disk, [configured])
  const first = mount()
  await ready()
  expect(first.queryByText('q1')).toBeNull()
  act(() => client.capture('trigger', {}))
  await waitFor(() => expect(first.queryByText('q1')).not.toBeNull())
  fireEvent.click(first.getByText('q1'))
  const initial = lastModalProps.initialProgress
  expect(first.queryByText('q2')).not.toBeNull()
  await client.storage.waitForPersist()
  first.unmount()
  client = makeClient(disk, [configured], { eligible: false })
  const second = mount()
  await ready()
  await waitFor(() => expect(second.queryByText('q2')).not.toBeNull())
  expect(second.queryByText('q1')).toBeNull()
  expect(client.capture.mock.calls.filter(([event]: any) => event === 'survey sent')).toHaveLength(0)
  fireEvent.click(second.getByText('q2'))
  expect(client.capture).toHaveBeenCalledWith(
    'survey sent',
    expect.objectContaining({
      $survey_completed: true,
      $survey_submission_id: initial.submissionId,
      $survey_response_q1: 'answer-q1',
      $survey_response_q2: 'answer-q2',
    })
  )
  expect(second.queryByText('Thank you')).not.toBeNull()
  expect(client.getPersistedProperty(PostHogPersistedProperty.SurveysInProgress)).toEqual([])
  await client.storage.waitForPersist()
  second.unmount()
  client = makeClient(disk, [configured])
  const third = mount()
  await ready()
  act(() => client.capture('trigger', {}))
  expect(third.queryByText('q1')).toBeNull()
})

it('dismisses with saved responses and clears progress without a completion event', async () => {
  client = makeClient(new Map())
  const view = mount()
  await ready()
  act(() => client.capture('trigger', {}))
  fireEvent.click(await view.findByText('q1'))
  fireEvent.click(view.getByText('Close'))
  expect(client.capture).toHaveBeenCalledWith(
    'survey dismissed',
    expect.objectContaining({
      $survey_submission_id: expect.any(String),
      $survey_partially_completed: true,
      $survey_response_q1: 'answer-q1',
    })
  )
  expect(client.getPersistedProperty(PostHogPersistedProperty.SurveysInProgress)).toEqual([])
  expect(
    client.capture.mock.calls.filter(([event, props]: any) => event === 'survey sent' && props.$survey_completed)
  ).toHaveLength(0)
})

it.each(['reset', 'optOut'])('invalidates mounted and stale callbacks on %s', async (action) => {
  client = makeClient(new Map())
  const view = mount()
  await ready()
  act(() => client.capture('trigger', {}))
  fireEvent.click(await view.findByText('q1'))
  const oldProps = lastModalProps
  client.capture.mockClear()
  await act(async () => {
    client.optedOut = action === 'optOut'
    client.resetSurveyState()
  })
  expect(view.queryByText('q2')).toBeNull()
  act(() => oldProps.onShow())
  expect(oldProps.onProgressChange(oldProps.initialProgress, false)).toBe(false)
  act(() => oldProps.onClose(false, oldProps.initialProgress.responses))
  expect(client.capture).not.toHaveBeenCalled()
  expect(client.getPersistedProperty(PostHogPersistedProperty.SurveysInProgress)).toBeUndefined()
})
