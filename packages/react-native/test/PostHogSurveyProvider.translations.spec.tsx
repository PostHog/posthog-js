/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Survey, SurveyQuestionType, SurveyType } from '@posthog/core'
import { PostHog } from '../src/posthog-rn'
import { PostHogSurveyProvider } from '../src/surveys/PostHogSurveyProvider'
import * as translations from '../src/surveys/survey-translations'
import { setupFetch } from './test-utils'

// Keep the provider, modal, questions, translation and event paths real; only
// native primitives are replaced with interactive DOM equivalents.
vi.mock('react-native', async () => {
  const native = await vi.importActual<typeof import('./mocks/react-native')>('./mocks/react-native')
  const R = await vi.importActual<typeof import('react')>('react')
  const Box = ({ children }: any) => R.createElement('div', null, children)
  const Button = ({ children, onPress, disabled }: any) =>
    R.createElement('button', { onClick: onPress, disabled }, children)
  return {
    ...native,
    View: Box,
    Text: Box,
    ScrollView: Box,
    Modal: Box,
    KeyboardAvoidingView: Box,
    TouchableOpacity: Button,
    Pressable: Button,
    TextInput: ({ value, onChangeText }: any) =>
      R.createElement('input', { value, onChange: (e: any) => onChangeText(e.target.value) }),
  }
})
vi.mock('../src/optional/OptionalReactNativeSvg', () => ({ OptionalReactNativeSvg: undefined }))
vi.mock('../src/optional/OptionalReactNativeSafeArea', () => ({
  useOptionalSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
vi.mock('../src/surveys/components/Cancel', () => ({
  Cancel: ({ onPress }: { onPress: () => void }) => <button onClick={onPress}>Dismiss</button>,
}))
let posthog: PostHog
vi.mock('../src/hooks/usePostHog', () => ({ usePostHog: () => posthog }))

const makeSurvey = (): Survey => ({
  id: 'translated-survey',
  name: 'Survey',
  type: SurveyType.Popover,
  start_date: '2023-01-01T00:00:00Z',
  questions: [0, 1].map((index) => ({
    id: `q${index}`,
    type: SurveyQuestionType.Open,
    originalQuestionIndex: index,
    question: `Question ${index}`,
    translations: { es: { question: `Pregunta ${index}` } },
  })),
  appearance: { submitButtonText: 'Next', thankYouMessageHeader: 'Thanks' },
  translations: { es: { submitButtonText: 'Siguiente', thankYouMessageHeader: 'Gracias' } },
})

async function mount(survey = makeSurvey(), overrideDisplayLanguage?: string) {
  posthog = new PostHog('test-token', {
    persistence: 'memory',
    flushInterval: 0,
    preloadFeatureFlags: false,
    disableRemoteFeatureFlags: true,
    captureAppLifecycleEvents: false,
    overrideDisplayLanguage,
  })
  await posthog.ready()
  vi.spyOn(posthog, '_onSurveysReady').mockResolvedValue(undefined)
  vi.spyOn(posthog, 'getSurveys').mockResolvedValue([survey])
  vi.spyOn(posthog, 'getCommonEventProperties').mockReturnValue({ $locale: 'en-US' })
  vi.spyOn(posthog, 'capture').mockImplementation(() => {})
  const result = render(<PostHogSurveyProvider client={posthog}>{null}</PostHogSurveyProvider>)
  await act(async () => {})
  return result
}

function expectOnlyOneShown() {
  expect(vi.mocked(posthog.capture).mock.calls.filter(([event]) => event === 'survey shown')).toHaveLength(1)
}

beforeEach(() => {
  vi.useRealTimers()
  setupFetch()
})
afterEach(async () => {
  cleanup()
  await posthog?.shutdown()
  vi.restoreAllMocks()
})

it('retranslates after identify without losing the current question, draft, or previous answer', async () => {
  const ui = await mount()
  fireEvent.change(ui.getByRole('textbox'), { target: { value: 'First answer' } })
  fireEvent.click(ui.getByText('Next'))
  fireEvent.change(ui.getByRole('textbox'), { target: { value: 'Draft answer' } })

  act(() => posthog.identify('user', { language: 'es-MX' }))

  expect(ui.queryByText('Pregunta 1')).not.toBeNull()
  expect((ui.getByRole('textbox') as HTMLInputElement).value).toBe('Draft answer')
  fireEvent.click(ui.getByText('Siguiente'))
  expect(ui.queryByText('Gracias')).not.toBeNull()
  expect(posthog.capture).toHaveBeenCalledWith(
    'survey sent',
    expect.objectContaining({
      $survey_language: 'es',
      $survey_response_q0: 'First answer',
      $survey_response_q1: 'Draft answer',
    })
  )
  expectOnlyOneShown()
})

it('refreshes without a feature flag reload and dismisses with the displayed language', async () => {
  const ui = await mount()
  act(() => posthog.setPersonPropertiesForFlags({ language: 'es' }, false))
  expect(ui.queryByText('Pregunta 0')).not.toBeNull()
  vi.useFakeTimers()
  fireEvent.click(ui.getByText('Dismiss'))
  act(() => vi.runAllTimers())
  expect(posthog.capture).toHaveBeenCalledWith('survey dismissed', expect.objectContaining({ $survey_language: 'es' }))
  expectOnlyOneShown()
  vi.useRealTimers()
})

it.each(['unset', 'reset properties', 'reset', 'unmatched'])(
  'returns to original copy and removes event language after %s',
  async (operation) => {
    const ui = await mount()
    act(() => posthog.setPersonPropertiesForFlags({ language: 'es' }, false))
    expect(ui.queryByText('Pregunta 0')).not.toBeNull()
    act(() => {
      if (operation === 'unset') posthog.unsetPersonProperties('language', false)
      else if (operation === 'reset properties') posthog.resetPersonPropertiesForFlags(false)
      else if (operation === 'reset') posthog.reset()
      else posthog.setPersonPropertiesForFlags({ language: 'zz' }, false)
    })
    expect(ui.queryByText('Question 0')).not.toBeNull()
    fireEvent.change(ui.getByRole('textbox'), { target: { value: 'Answer' } })
    fireEvent.click(ui.getByText('Next'))
    fireEvent.change(ui.getByRole('textbox'), { target: { value: 'Answer 2' } })
    fireEvent.click(ui.getByText('Next'))
    const sent = vi.mocked(posthog.capture).mock.calls.find(([event]) => event === 'survey sent')
    expect(sent).toBeDefined()
    expect(sent![1]).not.toHaveProperty('$survey_language')
    expectOnlyOneShown()
  }
)

it('keeps override precedence and no-ops when the resolved language is unchanged', async () => {
  const ui = await mount(makeSurvey(), 'es')
  const translate = vi.spyOn(translations, 'applySurveyTranslationForUser')
  act(() => posthog.setPersonPropertiesForFlags({ language: 'fr' }, false))
  act(() => posthog.setPersonPropertiesForFlags({ plan: 'paid' }, false))
  expect(ui.queryByText('Pregunta 0')).not.toBeNull()
  expect(translate).not.toHaveBeenCalled()
  expectOnlyOneShown()
})

it('unsubscribes from person property changes when unmounted', async () => {
  const ui = await mount()
  const emitter = (posthog as any)._events
  expect(emitter.events.personProperties).toHaveLength(1)
  ui.unmount()
  expect(emitter.events.personProperties).toHaveLength(0)
})

it.each([
  [SurveyQuestionType.SingleChoice, true],
  [SurveyQuestionType.MultipleChoice, true],
  [SurveyQuestionType.SingleChoice, false],
  [SurveyQuestionType.MultipleChoice, false],
] as const)('preserves selected %s choices and open text (language change: %s)', async (type, changeLanguage) => {
  const survey = makeSurvey()
  survey.questions = [
    {
      id: 'choice',
      type,
      question: 'Pick',
      originalQuestionIndex: 0,
      choices: ['Apple', 'Other'],
      hasOpenChoice: true,
      translations: { es: { question: 'Elige', choices: ['Manzana', 'Otro'] } },
    },
  ]
  const ui = await mount(survey)
  fireEvent.click(ui.getByText('Apple'))
  if (type === SurveyQuestionType.MultipleChoice) {
    fireEvent.change(ui.getByRole('textbox'), { target: { value: 'Custom answer' } })
  }
  if (changeLanguage) {
    act(() => posthog.setPersonPropertiesForFlags({ language: 'es' }, false))
  }
  expect(ui.queryByText(changeLanguage ? 'Elige' : 'Pick')).not.toBeNull()
  const selectedLabel = changeLanguage ? 'Manzana' : 'Apple'
  // The checkmark remains on the selected option, even when its label changes.
  expect(ui.getByText(selectedLabel).closest('button')!.textContent).toBe(`${selectedLabel}v`)
  fireEvent.click(ui.getByText(changeLanguage ? 'Siguiente' : 'Next'))
  expect(posthog.capture).toHaveBeenCalledWith(
    'survey sent',
    expect.objectContaining({
      ...(changeLanguage ? { $survey_language: 'es' } : {}),
      $survey_response_choice:
        type === SurveyQuestionType.SingleChoice ? selectedLabel : [selectedLabel, 'Custom answer'],
    })
  )
  expectOnlyOneShown()
})

it('keeps a selected single open choice and its draft when translating', async () => {
  const survey = makeSurvey()
  survey.questions = [
    {
      id: 'choice',
      type: SurveyQuestionType.SingleChoice,
      question: 'Pick',
      originalQuestionIndex: 0,
      choices: ['Apple', 'Other'],
      hasOpenChoice: true,
      translations: { es: { question: 'Elige', choices: ['Manzana', 'Otro'] } },
    },
  ]
  const ui = await mount(survey)
  fireEvent.change(ui.getByRole('textbox'), { target: { value: 'Custom answer' } })
  act(() => posthog.setPersonPropertiesForFlags({ language: 'es' }, false))
  expect(ui.queryByText('Elige')).not.toBeNull()
  expect((ui.getByRole('textbox') as HTMLInputElement).value).toBe('Custom answer')
  fireEvent.click(ui.getByText('Siguiente'))
  expect(posthog.capture).toHaveBeenCalledWith(
    'survey sent',
    expect.objectContaining({
      $survey_language: 'es',
      $survey_response_choice: 'Custom answer',
    })
  )
})

it('does not retranslate for unchanged person language or unrelated properties', async () => {
  const ui = await mount()
  act(() => posthog.setPersonPropertiesForFlags({ language: 'es' }, false))
  const translate = vi.spyOn(translations, 'applySurveyTranslationForUser')
  act(() => posthog.setPersonPropertiesForFlags({ language: 'es' }, false))
  act(() => posthog.setPersonPropertiesForFlags({ plan: 'paid' }, false))
  expect(ui.queryByText('Pregunta 0')).not.toBeNull()
  expect(translate).not.toHaveBeenCalled()
  expectOnlyOneShown()
})

it('uses the device locale translation after removing the person language', async () => {
  const ui = await mount()
  vi.mocked(posthog.getCommonEventProperties).mockReturnValue({ $locale: 'es-MX' })
  act(() => posthog.setPersonPropertiesForFlags({ language: 'fr' }, false))
  expect(ui.queryByText('Question 0')).not.toBeNull()
  act(() => posthog.unsetPersonProperties('language', false))
  expect(ui.queryByText('Pregunta 0')).not.toBeNull()
  expectOnlyOneShown()
})

it('preserves a selected rating when translating', async () => {
  const survey = makeSurvey()
  survey.questions = [
    {
      id: 'rating',
      type: SurveyQuestionType.Rating,
      question: 'Rate',
      originalQuestionIndex: 0,
      display: 'number',
      scale: 5,
      lowerBoundLabel: 'Low',
      upperBoundLabel: 'High',
      translations: { es: { question: 'Califica', lowerBoundLabel: 'Bajo', upperBoundLabel: 'Alto' } },
    },
  ]
  const ui = await mount(survey)
  fireEvent.click(ui.getByText('4'))
  act(() => posthog.setPersonPropertiesForFlags({ language: 'es' }, false))
  expect(ui.queryByText('Califica')).not.toBeNull()
  expect(ui.queryByText('Bajo')).not.toBeNull()
  fireEvent.click(ui.getByText('Siguiente'))
  expect(posthog.capture).toHaveBeenCalledWith(
    'survey sent',
    expect.objectContaining({
      $survey_language: 'es',
      $survey_response_rating: 4,
    })
  )
  expectOnlyOneShown()
})
