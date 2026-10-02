/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultipleSurveyQuestion, SurveyQuestionType } from '@posthog/core'

vi.mock('react-native', async () => {
  const RealReact = await vi.importActual<typeof import('react')>('react')
  const strip = (props: any) => {
    const domProps = { ...props }
    delete domProps.maxFontSizeMultiplier
    delete domProps.keyboardShouldPersistTaps
    delete domProps.showsVerticalScrollIndicator
    delete domProps.scrollEnabled
    delete domProps.bounces
    delete domProps.onLayout
    delete domProps.onContentSizeChange
    return domProps
  }
  const Box = ({ children, ...props }: any) => RealReact.createElement('div', strip(props), children)
  const Text = ({ children, ...props }: any) => RealReact.createElement('span', strip(props), children)
  const Pressable = ({ children, onPress, ...props }: any) =>
    RealReact.createElement('button', { ...strip(props), onClick: onPress }, children)

  return {
    View: Box,
    ScrollView: Box,
    Text,
    TextInput: 'input',
    Pressable,
    TouchableOpacity: Pressable,
    StyleSheet: { create: (styles: any) => styles },
    Linking: { canOpenURL: vi.fn(), openURL: vi.fn() },
  }
})

import { MultipleChoiceQuestion } from '../src/surveys/components/QuestionTypes'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

const question: MultipleSurveyQuestion = {
  type: SurveyQuestionType.SingleChoice,
  question: 'Choose one',
  originalQuestionIndex: 0,
  choices: ['Alpha', 'Beta', 'Gamma'],
  shuffleOptions: true,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MultipleChoiceQuestion', () => {
  it('submits the displayed choice after shuffled options are selected', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const onSubmit = vi.fn()
    const { getByRole } = render(
      <MultipleChoiceQuestion question={question} appearance={defaultSurveyAppearance} onSubmit={onSubmit} />
    )

    fireEvent.click(getByRole('button', { name: 'Beta' }))
    fireEvent.click(getByRole('button', { name: 'Submit' }))

    expect(onSubmit).toHaveBeenCalledWith('Beta')
  })
})
