/** @vitest-environment jsdom */
import React from 'react'
import { render, cleanup } from '@testing-library/react'

// Records the style every Text/TextInput is rendered with, so a test can assert
// which font reached which node.
const renderedTextProps: { children: unknown; style: unknown }[] = []

vi.mock('react-native', async () => {
  const RealReact = await vi.importActual<typeof import('react')>('react')
  const Box = RealReact.forwardRef(({ children, testID }: any, ref: any) =>
    RealReact.createElement('div', { ref, 'data-testid': testID }, children)
  )
  const RecordingText = RealReact.forwardRef(({ children, style, testID }: any, ref: any) => {
    renderedTextProps.push({ children, style })
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
    Linking: { canOpenURL: vi.fn(), openURL: vi.fn() },
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  }
})

vi.mock('../src/optional/OptionalReactNativeSvg', () => ({ OptionalReactNativeSvg: undefined }))

import { BottomSection } from '../src/surveys/components/BottomSection'
import { QuestionHeader } from '../src/surveys/components/QuestionHeader'
import { defaultSurveyAppearance, getFontFamily, SurveyAppearanceTheme } from '../src/surveys/surveys-utils'

const fontOf = (text: string): unknown => {
  const style = renderedTextProps.find((entry) => entry.children === text)?.style
  const flat = Object.assign({}, ...[style].flat(Infinity).filter(Boolean))
  return flat.fontFamily
}

beforeEach(() => {
  renderedTextProps.length = 0
})

afterEach(cleanup)

describe('getFontFamily', () => {
  it('uses the system font when no font is set', () => {
    expect(getFontFamily({})).toBeUndefined()
    expect(getFontFamily({ fontFamily: '' })).toBeUndefined()
    expect(getFontFamily({ fontFamily: '   ' })).toBeUndefined()
  })

  it('treats the CSS keywords the survey editor offers as the system font', () => {
    expect(getFontFamily({ fontFamily: 'inherit' })).toBeUndefined()
    expect(getFontFamily({ fontFamily: 'system-ui' })).toBeUndefined()
  })

  it('passes a font name through', () => {
    expect(getFontFamily({ fontFamily: 'Georgia' })).toBe('Georgia')
    expect(getFontFamily({ fontFamily: ' Courier New ' })).toBe('Courier New')
  })

  it('ignores a value that is not a string', () => {
    expect(getFontFamily({ fontFamily: null as unknown as string })).toBeUndefined()
    expect(getFontFamily({ fontFamily: 12 as unknown as string })).toBeUndefined()
  })
})

describe('survey text font', () => {
  const base: SurveyAppearanceTheme = { ...defaultSurveyAppearance }

  it('applies the survey font to the question, description and button', () => {
    const appearance = { ...base, fontFamily: 'Georgia' }
    render(<QuestionHeader question="What went wrong?" description="Tell us more" appearance={appearance} />)
    render(<BottomSection text="Send feedback" submitDisabled={false} appearance={appearance} onSubmit={() => {}} />)

    expect(fontOf('What went wrong?')).toBe('Georgia')
    expect(fontOf('Tell us more')).toBe('Georgia')
    expect(fontOf('Send feedback')).toBe('Georgia')
  })

  it('leaves the system font in place for the editor default', () => {
    render(
      <QuestionHeader
        question="What went wrong?"
        description="Tell us more"
        appearance={{ ...base, fontFamily: 'inherit' }}
      />
    )

    expect(fontOf('What went wrong?')).toBeUndefined()
    expect(fontOf('Tell us more')).toBeUndefined()
  })
})
