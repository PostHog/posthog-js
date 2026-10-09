/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { TouchableOpacityProps } from 'react-native'
import { Cancel } from '../src/surveys/components/Cancel'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'

// Map the native accessibility props to DOM semantics for the component test.
vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-native')>()),
  TouchableOpacity: ({ accessibilityRole, accessibilityLabel, onPress, children }: TouchableOpacityProps) =>
    React.createElement(
      'div',
      { role: accessibilityRole, 'aria-label': accessibilityLabel, onClick: onPress },
      children
    ),
}))

vi.mock('../src/surveys/icons', () => ({ CancelSVG: () => null }))

describe('Survey close control', () => {
  afterEach(cleanup)

  it('exposes a button named Close survey', () => {
    const { getByRole } = render(<Cancel appearance={defaultSurveyAppearance} onPress={vi.fn()} />)

    expect(getByRole('button', { name: 'Close survey' })).toBeTruthy()
  })

  it('calls onPress once when activated', () => {
    const onPress = vi.fn()
    const { getByRole } = render(<Cancel appearance={defaultSurveyAppearance} onPress={onPress} />)

    fireEvent.click(getByRole('button', { name: 'Close survey' }))

    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
