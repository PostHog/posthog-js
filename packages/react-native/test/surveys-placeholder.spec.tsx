/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { Survey, SurveyQuestionType, SurveyType } from '@posthog/core'

// Render native primitives in jsdom while keeping the provider, modal and question components real.
vi.mock('react-native', async () => {
  const R = await vi.importActual<typeof import('react')>('react')
  const Box = ({ children }: any) => R.createElement('div', null, children)
  return {
    View: Box,
    Modal: Box,
    KeyboardAvoidingView: Box,
    ScrollView: Box,
    Text: Box,
    Pressable: Box,
    TouchableOpacity: Box,
    TextInput: ({ placeholder, value, onChangeText }: any) =>
      R.createElement('textarea', { placeholder, value, onChange: (event: any) => onChangeText(event.target.value) }),
    Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: vi.fn() }) },
    Linking: { openURL: vi.fn() },
    Platform: { OS: 'android', select: (options: any) => options.android ?? options.default },
    StyleSheet: { create: (styles: any) => styles, flatten: (styles: any) => styles, absoluteFill: {} },
    Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove: vi.fn() }) },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  }
})

vi.mock('../src/native-deps', () => ({ currentDeviceType: 'Mobile' }))
vi.mock('../src/hooks/usePostHog', () => ({ usePostHog: () => mockClient }))

import { PostHogSurveyProvider } from '../src/surveys/PostHogSurveyProvider'

let mockClient: any

const survey: Survey = {
  id: 'placeholder-survey',
  name: 'Placeholder survey',
  type: SurveyType.Popover,
  questions: [{ id: 'q1', type: SurveyQuestionType.Open, question: 'What do you think?' }],
  start_date: '2023-01-01T00:00:00Z',
}

describe('survey open text placeholder', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mockClient = {
      ready: vi.fn(() => Promise.resolve()),
      _onSurveysReady: vi.fn(() => Promise.resolve()),
      getSurveys: vi.fn(),
      getFeatureFlags: vi.fn(() => ({})),
      onFeatureFlags: vi.fn(() => () => {}),
      getSurveyDisplayLanguageOverride: vi.fn(),
      getCommonEventProperties: vi.fn(() => ({})),
      getPersistedProperty: vi.fn(),
      setPersistedProperty: vi.fn(),
      capture: vi.fn(),
      on: vi.fn(() => () => {}),
    }
  })

  afterEach(() => {
    cleanup()
    vi.useFakeTimers()
  })

  it.each([
    { label: 'no appearance configured', appearance: undefined, expected: '' },
    { label: 'null appearance', appearance: null, expected: '' },
    { label: 'empty appearance', appearance: {}, expected: '' },
    { label: 'cleared placeholder', appearance: { placeholder: '' }, expected: '' },
    { label: 'custom placeholder', appearance: { placeholder: 'Tell us more...' }, expected: 'Tell us more...' },
  ])('renders open text with $label', async ({ appearance, expected }) => {
    mockClient.getSurveys.mockResolvedValue([{ ...survey, appearance }])
    const { findByRole } = render(
      <PostHogSurveyProvider client={mockClient}>
        <div />
      </PostHogSurveyProvider>
    )

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(((await findByRole('textbox')) as HTMLTextAreaElement).placeholder).toBe(expected)
  })
})
