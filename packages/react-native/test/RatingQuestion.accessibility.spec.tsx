/** @vitest-environment jsdom */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { TouchableOpacityProps } from 'react-native'
import { RatingQuestion } from '../src/surveys/components/QuestionTypes'
import { defaultSurveyAppearance } from '../src/surveys/surveys-utils'
import { RatingSurveyQuestion, SurveyQuestionType, SurveyRatingDisplay } from '@posthog/core'

// Exercise the real question; only translate native semantics for the DOM renderer.
vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-native')>()),
  View: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
  Text: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
  ScrollView: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
  TouchableOpacity: ({
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
    onPress,
    children,
  }: TouchableOpacityProps) =>
    React.createElement(
      'div',
      {
        role: accessibilityRole,
        'aria-label': accessibilityLabel,
        'aria-checked': accessibilityState?.checked,
        onClick: onPress,
      },
      children
    ),
}))

const question: RatingSurveyQuestion = {
  type: SurveyQuestionType.Rating,
  question: 'How likely are you to recommend us?',
  display: SurveyRatingDisplay.Number,
  scale: 10,
  lowerBoundLabel: 'Not at all likely',
  upperBoundLabel: 'Extremely likely',
}

afterEach(cleanup)

describe('numeric rating accessibility', () => {
  it.each([5, 7, 10] as const)('names every option using its question and preserves selection on scale %i', (scale) => {
    const onSubmit = vi.fn()
    const { getAllByRole, getByRole } = render(
      <RatingQuestion question={{ ...question, scale }} appearance={defaultSurveyAppearance} onSubmit={onSubmit} />
    )
    const start = scale === 10 ? 0 : 1
    const radios = getAllByRole('radio')
    expect(radios).toHaveLength(scale - start + 1)
    expect(getByRole('radio', { name: `${start}, ${question.question}, ${question.lowerBoundLabel}` })).toBe(radios[0])
    expect(getByRole('radio', { name: `${scale}, ${question.question}, ${question.upperBoundLabel}` })).toBe(
      radios[radios.length - 1]
    )
    const middle = getByRole('radio', { name: `3, ${question.question}` })
    expect(getAllByRole('radio', { checked: false })).toHaveLength(radios.length)
    fireEvent.click(middle)
    expect(getByRole('radio', { checked: true })).toBe(middle)
    fireEvent.click(radios[0])
    expect(getByRole('radio', { checked: true })).toBe(radios[0])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each([2, 3] as const)('labels the rendered endpoints when scale %i falls back to 1–5', (scale) => {
    const { getAllByRole, getByRole } = render(
      <RatingQuestion question={{ ...question, scale }} appearance={defaultSurveyAppearance} onSubmit={vi.fn()} />
    )
    const radios = getAllByRole('radio')
    expect(radios).toHaveLength(5)
    expect(getByRole('radio', { name: `1, ${question.question}, ${question.lowerBoundLabel}` })).toBe(radios[0])
    expect(getByRole('radio', { name: `5, ${question.question}, ${question.upperBoundLabel}` })).toBe(radios[4])
    expect(getByRole('radio', { name: `${scale}, ${question.question}` })).toBe(radios[scale - 1])
  })

  it('uses translated question and endpoint strings without English helper copy', () => {
    const { getByRole } = render(
      <RatingQuestion
        question={{
          ...question,
          question: 'Wie wahrscheinlich ist eine Empfehlung?',
          lowerBoundLabel: 'Unwahrscheinlich',
          upperBoundLabel: 'Sehr wahrscheinlich',
        }}
        appearance={defaultSurveyAppearance}
        onSubmit={vi.fn()}
      />
    )
    expect(getByRole('radio', { name: '0, Wie wahrscheinlich ist eine Empfehlung?, Unwahrscheinlich' })).toBeTruthy()
    expect(
      getByRole('radio', { name: '10, Wie wahrscheinlich ist eine Empfehlung?, Sehr wahrscheinlich' })
    ).toBeTruthy()
  })

  it('still immediately submits the numeric value when skipSubmitButton is enabled', () => {
    const onSubmit = vi.fn()
    const { getByRole } = render(
      <RatingQuestion
        question={{ ...question, skipSubmitButton: true }}
        appearance={defaultSurveyAppearance}
        onSubmit={onSubmit}
      />
    )
    fireEvent.click(getByRole('radio', { name: `0, ${question.question}, ${question.lowerBoundLabel}` }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(0)
  })
})
