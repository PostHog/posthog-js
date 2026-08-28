/** @jest-environment jsdom */
import React from 'react'
import { cleanup, render } from '@testing-library/react'

jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  const flattenStyle = (style: any) => (Array.isArray(style) ? Object.assign({}, ...style) : style)
  const Box = ({ children, style, ...props }: any) =>
    RealReact.createElement('div', { ...props, style: flattenStyle(style) }, children)

  return {
    View: Box,
    Text: Box,
    StyleSheet: { create: (styles: any) => styles },
  }
})

import { QuestionHeader } from '../src/surveys/components/QuestionHeader'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

describe('QuestionHeader', () => {
  afterEach(cleanup)

  it('reserves space for the modal cancel button when questions wrap', () => {
    const { container } = render(
      <QuestionHeader
        question="A long survey question that must wrap before reaching the top-right cancel button"
        appearance={defaultSurveyAppearance}
      />
    )

    expect((container.firstElementChild as HTMLElement).style.paddingRight).toBe('40px')
  })
})
