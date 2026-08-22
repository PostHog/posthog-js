/** @jest-environment jsdom */
import React from 'react'
import { render, cleanup } from '@testing-library/react'

// Records the props every Text/TextInput is rendered with, so a test can assert
// which ceiling reached which node. Same minimal react-native shim as
// SurveyModal.spec — jest-expo's full preset pulls in TurboModule code that
// explodes under jsdom.
const renderedTextProps: { children: unknown; maxFontSizeMultiplier: number | undefined }[] = []

jest.mock('react-native', () => {
  const RealReact = jest.requireActual('react')
  const Box = RealReact.forwardRef(({ children, testID, ...rest }: any, ref: any) =>
    RealReact.createElement('div', { ref, 'data-testid': testID }, children)
  )
  const RecordingText = RealReact.forwardRef(({ children, maxFontSizeMultiplier, testID }: any, ref: any) => {
    renderedTextProps.push({ children, maxFontSizeMultiplier })
    return RealReact.createElement('div', { ref, 'data-testid': testID }, children)
  })
  return {
    View: Box,
    Modal: Box,
    KeyboardAvoidingView: Box,
    Pressable: Box,
    TouchableOpacity: Box,
    Text: RecordingText,
    TextInput: RecordingText,
    Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  }
})

import { BottomSection } from '../src/surveys/components/BottomSection'
import { QuestionHeader } from '../src/surveys/components/QuestionHeader'
import { defaultSurveyAppearance, getMaxFontSizeMultiplier, SurveyAppearanceTheme } from '../src/surveys/surveys-utils'

const capOf = (text: string): number | undefined =>
  renderedTextProps.find((entry) => entry.children === text)?.maxFontSizeMultiplier

beforeEach(() => {
  renderedTextProps.length = 0
})

afterEach(cleanup)

describe('getMaxFontSizeMultiplier', () => {
  it('returns undefined when nothing is configured, so text keeps scaling as it does today', () => {
    expect(getMaxFontSizeMultiplier({}, 'question')).toBeUndefined()
    expect(getMaxFontSizeMultiplier({ maxFontSizeMultiplier: undefined }, 'question')).toBeUndefined()
  })

  it('applies a plain number to every role', () => {
    const appearance = { maxFontSizeMultiplier: 1.6 }
    expect(getMaxFontSizeMultiplier(appearance, 'question')).toBe(1.6)
    expect(getMaxFontSizeMultiplier(appearance, 'ratingNumber')).toBe(1.6)
    expect(getMaxFontSizeMultiplier(appearance, 'input')).toBe(1.6)
  })

  it('applies per-role ceilings independently', () => {
    const appearance = { maxFontSizeMultiplier: { question: 1.5, ratingNumber: 1.2 } }
    expect(getMaxFontSizeMultiplier(appearance, 'question')).toBe(1.5)
    expect(getMaxFontSizeMultiplier(appearance, 'ratingNumber')).toBe(1.2)
  })

  it('leaves roles the object omits uncapped', () => {
    const appearance = { maxFontSizeMultiplier: { question: 1.5 } }
    expect(getMaxFontSizeMultiplier(appearance, 'description')).toBeUndefined()
  })

  it('passes 0 through instead of swallowing it', () => {
    // In React Native 0 means "no maximum" — a distinct, documented value, not
    // an absent one. A truthiness check here would turn it into `undefined`,
    // which happens to render the same but stops meaning what the caller said.
    expect(getMaxFontSizeMultiplier({ maxFontSizeMultiplier: 0 }, 'question')).toBe(0)
    expect(getMaxFontSizeMultiplier({ maxFontSizeMultiplier: { question: 0 } }, 'question')).toBe(0)
  })
})

describe('survey text ceilings', () => {
  const base: SurveyAppearanceTheme = { ...defaultSurveyAppearance }

  it('passes no ceiling when the appearance does not configure one', () => {
    render(<QuestionHeader question="What went wrong?" description="Tell us more" appearance={base} />)

    expect(renderedTextProps).toHaveLength(2)
    expect(renderedTextProps.every((entry) => entry.maxFontSizeMultiplier === undefined)).toBe(true)
  })

  it('gives the question headline and its description their own ceilings', () => {
    render(
      <QuestionHeader
        question="What went wrong?"
        description="Tell us more"
        appearance={{ ...base, maxFontSizeMultiplier: { question: 1.4, description: 1.9 } }}
      />
    )

    expect(capOf('What went wrong?')).toBe(1.4)
    expect(capOf('Tell us more')).toBe(1.9)
  })

  it('caps the submit button independently of the question', () => {
    render(
      <BottomSection
        text="Send feedback"
        submitDisabled={false}
        appearance={{ ...base, maxFontSizeMultiplier: { question: 2, button: 1.3 } }}
        onSubmit={() => {}}
      />
    )

    expect(capOf('Send feedback')).toBe(1.3)
  })

  it('applies a single number to every role it renders', () => {
    render(
      <QuestionHeader
        question="What went wrong?"
        description="Tell us more"
        appearance={{ ...base, maxFontSizeMultiplier: 1.6 }}
      />
    )

    expect(capOf('What went wrong?')).toBe(1.6)
    expect(capOf('Tell us more')).toBe(1.6)
  })
})
