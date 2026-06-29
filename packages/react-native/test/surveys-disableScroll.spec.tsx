/** @jest-environment jsdom */
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { SurveyQuestionType, OpenSurveyQuestion } from '@posthog/core'

// Minimal react-native shim — jest-expo's full preset chain pulls in
// TurboModule code that explodes under jsdom. Everything renders as a plain
// div so children appear in the DOM. ScrollView is tagged so tests can assert
// whether QuestionLayout chose the scrollable wrapper or the plain View.
jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  const stripNativeProps = (props: any) => {
    const domProps = { ...props }
    delete domProps.keyboardShouldPersistTaps
    delete domProps.showsVerticalScrollIndicator
    delete domProps.multiline
    delete domProps.numberOfLines
    delete domProps.placeholderTextColor
    delete domProps.onChangeText
    delete domProps.underlineColorAndroid
    return domProps
  }
  const Box = RealReact.forwardRef(({ children, testID, ...rest }: any, ref: any) =>
    RealReact.createElement('div', { ref, 'data-testid': testID, ...stripNativeProps(rest) }, children)
  )
  const ScrollView = RealReact.forwardRef(({ children, ...rest }: any, ref: any) =>
    RealReact.createElement('div', { ref, 'data-testid': 'survey-scrollview', ...stripNativeProps(rest) }, children)
  )
  const Pressable = RealReact.forwardRef(({ children, testID, onPress, ...rest }: any, ref: any) =>
    RealReact.createElement(
      'div',
      { ref, 'data-testid': testID, onClick: onPress, ...stripNativeProps(rest) },
      children
    )
  )
  return {
    View: Box,
    ScrollView,
    Text: Box,
    TextInput: Box,
    Pressable,
    TouchableOpacity: Pressable,
    Linking: { openURL: jest.fn() },
    StyleSheet: {
      create: (s: any) => s,
      flatten: (s: any) => s,
      absoluteFill: {},
    },
  }
})

import { OpenTextQuestion } from '../src/surveys/components/QuestionTypes'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

const openQuestion: OpenSurveyQuestion = {
  type: SurveyQuestionType.Open,
  question: 'What do you think?',
  originalQuestionIndex: 0,
}

const renderQuestion = (disableSurveyScroll?: boolean) =>
  render(
    <OpenTextQuestion
      question={openQuestion}
      appearance={defaultSurveyAppearance}
      disableSurveyScroll={disableSurveyScroll}
      onSubmit={() => {}}
    />
  )

describe('QuestionLayout disableSurveyScroll', () => {
  afterEach(() => {
    cleanup()
  })

  it('wraps question content in a ScrollView by default', () => {
    const { queryByTestId, getByText } = renderQuestion()

    expect(queryByTestId('survey-scrollview')).not.toBeNull()
    expect(getByText('What do you think?')).not.toBeNull()
  })

  it('wraps question content in a ScrollView when disableSurveyScroll is false', () => {
    const { queryByTestId } = renderQuestion(false)

    expect(queryByTestId('survey-scrollview')).not.toBeNull()
  })

  it('renders a plain View instead of a ScrollView when disableSurveyScroll is true', () => {
    const { queryByTestId, getByText } = renderQuestion(true)

    expect(queryByTestId('survey-scrollview')).toBeNull()
    // Content is still rendered, just without the scrollable wrapper.
    expect(getByText('What do you think?')).not.toBeNull()
  })
})
