/** @jest-environment jsdom */
import React from 'react'
import { act, render, cleanup } from '@testing-library/react'
import { SurveyQuestionType, OpenSurveyQuestion } from '@posthog/core'

// Minimal react-native shim — jest-expo's full preset chain explodes under
// jsdom. ScrollView reflects scrollEnabled as a data attribute and stashes its
// layout callbacks so the test can drive viewport/content sizes.
let scrollViewCallbacks: {
  onLayout?: (e: { nativeEvent: { layout: { height: number } } }) => void
  onContentSizeChange?: (width: number, height: number) => void
} = {}

jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  const strip = (props: any) => {
    const domProps = { ...props }
    delete domProps.keyboardShouldPersistTaps
    delete domProps.showsVerticalScrollIndicator
    delete domProps.bounces
    delete domProps.multiline
    delete domProps.numberOfLines
    delete domProps.placeholderTextColor
    delete domProps.onChangeText
    delete domProps.underlineColorAndroid
    return domProps
  }
  const Box = RealReact.forwardRef(({ children, testID, ...rest }: any, ref: any) =>
    RealReact.createElement('div', { ref, 'data-testid': testID, ...strip(rest) }, children)
  )
  const ScrollView = RealReact.forwardRef(
    ({ children, scrollEnabled, onLayout, onContentSizeChange, ...rest }: any, ref: any) => {
      scrollViewCallbacks = { onLayout, onContentSizeChange }
      return RealReact.createElement(
        'div',
        {
          ref,
          'data-testid': 'survey-scrollview',
          'data-scroll-enabled': String(!!scrollEnabled),
          ...strip(rest),
        },
        children
      )
    }
  )
  const Pressable = RealReact.forwardRef(({ children, testID, onPress, ...rest }: any, ref: any) =>
    RealReact.createElement('div', { ref, 'data-testid': testID, onClick: onPress, ...strip(rest) }, children)
  )
  return {
    View: Box,
    ScrollView,
    Text: Box,
    TextInput: Box,
    Pressable,
    TouchableOpacity: Pressable,
    Linking: { openURL: jest.fn() },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, absoluteFill: {} },
  }
})

import { OpenTextQuestion } from '../src/surveys/components/QuestionTypes'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

const openQuestion: OpenSurveyQuestion = {
  type: SurveyQuestionType.Open,
  question: 'What do you think?',
  originalQuestionIndex: 0,
}

const renderQuestion = () =>
  render(<OpenTextQuestion question={openQuestion} appearance={defaultSurveyAppearance} onSubmit={() => {}} />)

// Simulate a native layout pass measuring viewport and content height.
const layout = (viewport: number, content: number) =>
  act(() => {
    scrollViewCallbacks.onLayout?.({ nativeEvent: { layout: { height: viewport } } })
    scrollViewCallbacks.onContentSizeChange?.(0, content)
  })

describe('QuestionLayout auto-scroll', () => {
  afterEach(() => {
    cleanup()
    scrollViewCallbacks = {}
  })

  it('keeps scrolling disabled before any layout has been measured', () => {
    const { getByTestId } = renderQuestion()
    expect(getByTestId('survey-scrollview').getAttribute('data-scroll-enabled')).toBe('false')
  })

  it.each([
    ['content fits the viewport', 500, 400, 'false'],
    ['content overflows the viewport', 500, 800, 'true'],
    ['content is sub-pixel taller than the viewport', 500, 500.4, 'false'],
    ['content sits exactly at the 1px threshold', 500, 501, 'false'],
    ['content is just past the 1px threshold', 500, 502, 'true'],
  ] as const)('%s (viewport=%s, content=%s) -> scrollEnabled=%s', (_label, viewport, content, expected) => {
    const { getByTestId } = renderQuestion()
    layout(viewport, content)
    expect(getByTestId('survey-scrollview').getAttribute('data-scroll-enabled')).toBe(expected)
  })

  it('re-disables scrolling when content shrinks back to fit', () => {
    const { getByTestId } = renderQuestion()
    layout(500, 800)
    expect(getByTestId('survey-scrollview').getAttribute('data-scroll-enabled')).toBe('true')
    layout(500, 300)
    expect(getByTestId('survey-scrollview').getAttribute('data-scroll-enabled')).toBe('false')
  })

  it('enables scrolling when the viewport shrinks under fixed content (keyboard opens)', () => {
    const { getByTestId } = renderQuestion()
    layout(800, 600)
    expect(getByTestId('survey-scrollview').getAttribute('data-scroll-enabled')).toBe('false')
    // Keyboard shrinks the modal: same content, smaller viewport -> overflow.
    layout(500, 600)
    expect(getByTestId('survey-scrollview').getAttribute('data-scroll-enabled')).toBe('true')
  })
})
