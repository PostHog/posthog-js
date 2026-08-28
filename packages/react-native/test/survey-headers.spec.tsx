/** @jest-environment jsdom */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'

// Minimal react-native shim — jest-expo's full preset chain pulls in
// TurboModule code that explodes under jsdom. Styles are flattened onto the
// DOM node so the resolved padding is readable from the rendered element.
jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  const flattenStyle = (style: any) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
  const Box = ({ children, style, ...rest }: any) =>
    RealReact.createElement('div', { ...rest, style: flattenStyle(style) }, children)
  const Pressable = ({ children, style, onPress, ...rest }: any) =>
    RealReact.createElement('div', { ...rest, style: flattenStyle(style), onClick: onPress }, children)

  return {
    View: Box,
    Text: Box,
    TouchableOpacity: Pressable,
    Linking: { openURL: jest.fn() },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
  }
})

import { ConfirmationMessage } from '../src/surveys/components/ConfirmationMessage'
import { IntroMessage } from '../src/surveys/components/IntroMessage'
import { QuestionHeader } from '../src/surveys/components/QuestionHeader'
import { closeButtonSize, defaultSurveyAppearance } from '../src/surveys/surveys-utils'

const LONG_HEADER = 'A long survey header that wraps before it reaches the top-right close button'

describe('survey headers', () => {
  afterEach(cleanup)

  // The close button is absolutely positioned in the modal's top-right corner, so every
  // screen that renders underneath it has to keep its text out of that corner.
  it.each([
    ['question', <QuestionHeader key="q" question={LONG_HEADER} appearance={defaultSurveyAppearance} />],
    [
      'intro',
      <IntroMessage
        key="i"
        appearance={defaultSurveyAppearance}
        header={LONG_HEADER}
        description=""
        onStart={jest.fn()}
      />,
    ],
    [
      'thank you',
      <ConfirmationMessage
        key="t"
        appearance={defaultSurveyAppearance}
        header={LONG_HEADER}
        description=""
        onClose={jest.fn()}
        isModal={true}
      />,
    ],
  ])('reserves room for the close button on the %s screen', (_name, element) => {
    render(element)
    const header = screen.getByText(LONG_HEADER) as HTMLElement

    expect(header.style.paddingRight).toBe(`${closeButtonSize}px`)
  })

  it('reserves room for a headerless intro description', () => {
    const description = 'A long intro description that wraps before it reaches the top-right close button'

    render(
      <IntroMessage
        appearance={defaultSurveyAppearance}
        header=""
        description={description}
        onStart={jest.fn()}
      />
    )

    const introDescription = screen.getByText(description) as HTMLElement
    expect(introDescription.style.paddingRight).toBe(`${closeButtonSize}px`)
  })
})
