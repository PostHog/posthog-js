/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { PressableProps, TextInputProps, TouchableOpacityProps } from 'react-native'
import { MultipleSurveyQuestion, SurveyQuestionType } from '@posthog/core'
import { MultipleChoiceQuestion } from '../src/surveys/components/QuestionTypes'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

// Native primitives are mapped to DOM semantics; no survey component is mocked.
vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-native')>()),
  View: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
  ScrollView: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
  Text: ({ children }: React.PropsWithChildren) => React.createElement('span', null, children),
  Pressable: ({ accessibilityRole, accessibilityLabel, accessibilityState, children, onPress }: PressableProps) =>
    React.createElement(
      'button',
      {
        role: accessibilityRole,
        'aria-label': accessibilityLabel,
        'aria-checked': accessibilityState?.checked,
        onClick: onPress,
      },
      children as React.ReactNode
    ),
  TouchableOpacity: ({ children, onPress, disabled }: TouchableOpacityProps) =>
    React.createElement('button', { onClick: onPress, disabled }, children),
  TextInput: (await import('react')).forwardRef<HTMLInputElement, TextInputProps>(
    ({ accessibilityLabel, onChangeText }, ref) =>
      React.createElement('input', {
        ref,
        'aria-label': accessibilityLabel,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText?.(event.target.value),
      })
  ),
  UIManager: { hasViewManagerConfig: () => false },
}))

const question: MultipleSurveyQuestion = {
  type: SurveyQuestionType.SingleChoice,
  question: 'What should we improve?',
  choices: ['Speed', 'Other'],
  hasOpenChoice: true,
}

afterEach(cleanup)

describe('open choice accessibility', () => {
  it.each([SurveyQuestionType.SingleChoice, SurveyQuestionType.MultipleChoice] as const)(
    'exposes a named text field outside a selectable accessibility wrapper for %s',
    (type) => {
      const onSubmit = vi.fn()
      const { getByRole } = render(
        <MultipleChoiceQuestion
          question={{ ...question, type }}
          appearance={defaultSurveyAppearance}
          onSubmit={onSubmit}
        />
      )
      const input = getByRole('textbox', { name: 'Other' })
      expect(input.closest('button')).toBeNull()
      fireEvent.click(getByRole(type === SurveyQuestionType.SingleChoice ? 'radio' : 'checkbox', { name: 'Other' }))
      expect(getByRole('textbox', { name: 'Other' })).toBe(input)
      expect(document.activeElement).toBe(input)
      expect(getByRole('button', { name: 'Submit' }).hasAttribute('disabled')).toBe(true)
      fireEvent.change(input, { target: { value: 'A custom answer' } })
      fireEvent.click(getByRole('button', { name: 'Submit' }))
      expect(onSubmit).toHaveBeenCalledWith(
        type === SurveyQuestionType.SingleChoice ? 'A custom answer' : ['A custom answer']
      )
    }
  )

  it('uses the translated open choice name', () => {
    const { getByRole } = render(
      <MultipleChoiceQuestion
        question={{ ...question, choices: ['Geschwindigkeit', 'Sonstiges'] }}
        appearance={defaultSurveyAppearance}
        onSubmit={vi.fn()}
      />
    )
    fireEvent.click(getByRole('radio', { name: 'Sonstiges' }))
    expect(document.activeElement).toBe(getByRole('textbox', { name: 'Sonstiges' }))
  })

  it('selects the open choice when typing directly and preserves other multiple-choice answers', () => {
    const onSubmit = vi.fn()
    const { getByRole } = render(
      <MultipleChoiceQuestion
        question={{ ...question, type: SurveyQuestionType.MultipleChoice }}
        appearance={defaultSurveyAppearance}
        onSubmit={onSubmit}
      />
    )
    fireEvent.click(getByRole('checkbox', { name: 'Speed' }))
    fireEvent.change(getByRole('textbox', { name: 'Other' }), { target: { value: 'Search' } })
    fireEvent.click(getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith(['Speed', 'Search'])
  })

  it('keeps the open-choice checkbox reachable for deselection without losing its draft', () => {
    const onSubmit = vi.fn()
    const { getByRole } = render(
      <MultipleChoiceQuestion
        question={{ ...question, type: SurveyQuestionType.MultipleChoice }}
        appearance={defaultSurveyAppearance}
        onSubmit={onSubmit}
      />
    )
    fireEvent.click(getByRole('checkbox', { name: 'Speed' }))
    fireEvent.change(getByRole('textbox', { name: 'Other' }), { target: { value: 'Search' } })
    const other = getByRole('checkbox', { name: 'Other', checked: true })
    other.focus()
    fireEvent.click(other)
    expect(document.activeElement).toBe(other)
    expect(getByRole('checkbox', { name: 'Other', checked: false })).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenLastCalledWith(['Speed'])
    fireEvent.click(getByRole('checkbox', { name: 'Other' }))
    fireEvent.click(getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenLastCalledWith(['Speed', 'Search'])
  })

  it('keeps ordinary choices operable and does not add an input when open choice is disabled', () => {
    const onSubmit = vi.fn()
    const { getByRole, queryByRole } = render(
      <MultipleChoiceQuestion
        question={{ ...question, hasOpenChoice: false, skipSubmitButton: true }}
        appearance={defaultSurveyAppearance}
        onSubmit={onSubmit}
      />
    )
    expect(queryByRole('textbox')).toBeNull()
    fireEvent.click(getByRole('radio', { name: 'Other' }))
    expect(onSubmit).toHaveBeenCalledWith('Other')
  })
})
