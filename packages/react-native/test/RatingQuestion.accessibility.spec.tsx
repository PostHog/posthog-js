/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { RatingSurveyQuestion, SurveyQuestionType } from '@posthog/core'

const radioAccessibility = new Map<string, { role: string; state: { checked: boolean } }>()

vi.mock('react-native', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const View = ({ children }: any) => ReactActual.createElement('div', null, children)
  const Text = ({ children }: any) => ReactActual.createElement('span', null, children)
  const ScrollView = ({ children }: any) => ReactActual.createElement('div', null, children)
  const TouchableOpacity = ({ children, onPress, accessibilityLabel, accessibilityRole, accessibilityState }: any) => {
    if (accessibilityRole === 'radio' && typeof accessibilityLabel === 'string') {
      radioAccessibility.set(accessibilityLabel, { role: accessibilityRole, state: accessibilityState })
    }

    return ReactActual.createElement('button', { onClick: onPress }, children)
  }

  return {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Pressable: TouchableOpacity,
    TextInput: () => ReactActual.createElement('input'),
    Linking: { canOpenURL: async () => false, openURL: async () => undefined },
    StyleSheet: { create: (styles: unknown) => styles },
  }
})

vi.mock('../src/optional/OptionalReactNativeSvg', () => ({ OptionalReactNativeSvg: undefined }))

import { RatingQuestion } from '../src/surveys/components/QuestionTypes'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

const question: RatingSurveyQuestion = {
  id: 'rating',
  type: SurveyQuestionType.Rating,
  question: '¿Qué probabilidad hay de que nos recomiendes?',
  display: 'number',
  scale: 5,
  lowerBoundLabel: 'Nada probable',
  upperBoundLabel: 'Muy probable',
  originalQuestionIndex: 0,
}

const optionLabel = (number: number) => `${question.question}: ${number}`

afterEach(() => {
  cleanup()
  radioAccessibility.clear()
})

describe('numeric rating accessibility', () => {
  it('gives each option question context and reports its checked state after selection', () => {
    const { getByText } = render(
      <RatingQuestion question={question} appearance={defaultSurveyAppearance} onSubmit={() => {}} />
    )

    for (const number of [1, 2, 3, 4, 5]) {
      expect(radioAccessibility.get(optionLabel(number))).toEqual({ role: 'radio', state: { checked: false } })
    }

    fireEvent.click(getByText('4'))

    expect(radioAccessibility.get(optionLabel(4))).toEqual({ role: 'radio', state: { checked: true } })
  })
})
