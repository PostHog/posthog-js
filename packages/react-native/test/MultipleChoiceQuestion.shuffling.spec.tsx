/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultipleSurveyQuestion, SurveyQuestionType } from '@posthog/core'

// Renders the REAL MultipleChoiceQuestion (unlike survey-response-attribution.spec.tsx and
// Questions.shuffling.spec.tsx, which both mock '../src/surveys/components/QuestionTypes' away).
// Only 'react-native' is replaced with DOM primitives, following the same mapping those specs use:
// View -> div, Text -> span, Pressable/TouchableOpacity -> button (onClick = onPress), TextInput -> input,
// StyleSheet.create -> identity. Platform/UIManager are stubbed so the optional react-native-svg icon
// falls back to its plain-text rendering instead of touching real native view managers.
vi.mock('react-native', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')

  // Only children and interaction handlers are forwarded to the DOM element. RN-only props
  // (style, maxFontSizeMultiplier, allowFontScaling, onLayout, ...) are intentionally dropped
  // rather than spread onto the div/span/button/input - forwarding them makes react-dom warn
  // about unrecognized DOM attributes, which test/setup.ts turns into a thrown test failure.
  const View = ({ children }: any) => ReactActual.createElement('div', null, children)
  const Text = ({ children }: any) => ReactActual.createElement('span', null, children)
  const ScrollView = ({ children }: any) => ReactActual.createElement('div', null, children)
  const Pressable = ({ children, onPress }: any) => ReactActual.createElement('button', { onClick: onPress }, children)
  const TouchableOpacity = ({ children, onPress, disabled }: any) =>
    ReactActual.createElement('button', { onClick: onPress, disabled }, children)
  const TextInput = ({ onChangeText }: any) =>
    ReactActual.createElement('input', { onChange: (event: any) => onChangeText?.(event.target.value) })

  return {
    View,
    Text,
    ScrollView,
    Pressable,
    TouchableOpacity,
    TextInput,
    StyleSheet: { create: (styles: unknown) => styles },
    Linking: { canOpenURL: async () => false, openURL: async () => undefined },
    Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
    UIManager: { hasViewManagerConfig: () => false },
  }
})

import { MultipleChoiceQuestion } from '../src/surveys/components/QuestionTypes'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

// The shuffle is random, so cases that depend on which display position a label lands on are
// repeated across many independent renders to catch a fix that only works for some positions.
const TRIALS = Array.from({ length: 20 }, (_, i) => i)

function makeQuestion(overrides: Partial<MultipleSurveyQuestion> = {}): MultipleSurveyQuestion {
  return {
    id: 'q1',
    type: SurveyQuestionType.SingleChoice,
    question: 'Pick one',
    choices: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
    shuffleOptions: true,
    originalQuestionIndex: 0,
    ...overrides,
  } as MultipleSurveyQuestion
}

// The Submit button text is a sibling of the choice buttons; excluding it leaves the choice
// labels in their rendered (i.e. shuffled) order. The open-ended choice's label carries a
// trailing ':' in the DOM, stripped here for comparison against question.choices.
function getRenderedChoiceLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button'))
    .map((button) => button.textContent ?? '')
    .filter((text) => text !== 'Submit')
    .map((text) => text.replace(/:$/, ''))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('display order sanity check', () => {
  // Guards against the other cases passing vacuously because the shuffle happened to be a no-op.
  it.each(TRIALS)('renders choices in a different order than question.choices (trial %i)', () => {
    const question = makeQuestion()
    const onSubmit = vi.fn()
    const { container } = render(
      <MultipleChoiceQuestion question={question} appearance={defaultSurveyAppearance} onSubmit={onSubmit} />
    )

    const rendered = getRenderedChoiceLabels(container)
    expect(rendered).not.toEqual(question.choices)
    expect([...rendered].sort()).toEqual([...question.choices].sort())
  })
})

describe('single choice with shuffled options', () => {
  const namedChoices = ['Alpha', 'Bravo', 'Charlie', 'Delta']

  it.each(TRIALS)('submits the tapped label from the display order, for every label (trial %i)', () => {
    for (const label of namedChoices) {
      const question = makeQuestion({ choices: namedChoices })
      const onSubmit = vi.fn()
      const { getByText } = render(
        <MultipleChoiceQuestion question={question} appearance={defaultSurveyAppearance} onSubmit={onSubmit} />
      )

      fireEvent.click(getByText(label))
      fireEvent.click(getByText('Submit'))

      expect(onSubmit).toHaveBeenCalledWith(label)
      cleanup()
    }
  })
})

describe('multiple choice with shuffled options', () => {
  const choices = ['Alpha', 'Bravo', 'Charlie', 'Delta']

  it.each(TRIALS)('submits both tapped labels, sorted, regardless of shuffle position (trial %i)', () => {
    const question = makeQuestion({ type: SurveyQuestionType.MultipleChoice, choices })
    const onSubmit = vi.fn()
    const { getByText } = render(
      <MultipleChoiceQuestion question={question} appearance={defaultSurveyAppearance} onSubmit={onSubmit} />
    )

    fireEvent.click(getByText('Alpha'))
    fireEvent.click(getByText('Charlie'))
    fireEvent.click(getByText('Submit'))

    expect(onSubmit).toHaveBeenCalledOnce()
    const [result] = onSubmit.mock.calls[0] as [string[]]
    expect([...result].sort()).toEqual(['Alpha', 'Charlie'].sort())
  })
})

describe('single choice with an open-ended choice and shuffled options', () => {
  const choices = ['Alpha', 'Bravo', 'Charlie', 'Other']
  const namedChoices = choices.slice(0, -1)

  it.each(TRIALS)('submits the tapped named label from the display order (trial %i)', () => {
    for (const label of namedChoices) {
      const question = makeQuestion({ choices, hasOpenChoice: true })
      const onSubmit = vi.fn()
      const { getByText } = render(
        <MultipleChoiceQuestion question={question} appearance={defaultSurveyAppearance} onSubmit={onSubmit} />
      )

      fireEvent.click(getByText(label))
      fireEvent.click(getByText('Submit'))

      expect(onSubmit).toHaveBeenCalledWith(label)
      cleanup()
    }
  })

  it.each(TRIALS)('submits the typed text for the open-ended choice (trial %i)', (trial) => {
    const question = makeQuestion({ choices, hasOpenChoice: true })
    const onSubmit = vi.fn()
    const { container, getByText } = render(
      <MultipleChoiceQuestion question={question} appearance={defaultSurveyAppearance} onSubmit={onSubmit} />
    )

    const input = container.querySelector('input')
    if (!input) {
      throw new Error('expected the open-ended TextInput to render')
    }
    const typedText = `custom answer ${trial}`
    fireEvent.change(input, { target: { value: typedText } })
    fireEvent.click(getByText('Submit'))

    expect(onSubmit).toHaveBeenCalledWith(typedText)
  })
})
