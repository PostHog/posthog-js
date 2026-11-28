/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { SurveyType, type Survey } from '@posthog/core'
import type { PostHog } from '../src/posthog-rn'
import { getActiveMatchingSurveys } from '../src/surveys/getActiveMatchingSurveys'
import { useActivatedSurveys } from '../src/surveys/useActivatedSurveys'

vi.mock('../src/native-deps', () => ({ currentDeviceType: 'Mobile' }))

function renderEligibleSurveys(conditions: Survey['conditions']) {
  const listeners = new Map<string, (payload?: unknown) => void>()
  const posthog = {
    on: (event: string, handler: (payload?: unknown) => void) => {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    },
  } as unknown as PostHog
  const surveys: Survey[] = [
    {
      id: 'checkout-survey',
      name: 'Checkout survey',
      description: '',
      type: SurveyType.Popover,
      questions: [],
      start_date: '2026-01-01T00:00:00Z',
      conditions,
    },
  ]

  const { result } = renderHook(() => getActiveMatchingSurveys(surveys, {}, [], useActivatedSurveys(posthog, surveys)))
  return {
    result,
    capture: (event: string, properties?: Record<string, unknown>) => {
      act(() => listeners.get('capture')?.({ event, properties }))
    },
    reset: () => act(() => listeners.get('surveysReset')?.()),
  }
}

describe('React Native survey activation', () => {
  it('requires a captured event matching one of the action steps and consumes activation when shown', () => {
    const steps = [
      { event: 'checkout', properties: [{ key: 'status', value: ['paid', 'refunded'] }] },
      { event: 'reorder' },
    ]
    const { result, capture, reset } = renderEligibleSurveys({ actions: { values: [{ id: 1, steps }] } })

    expect(result.current).toEqual([])
    capture('unrelated', { status: 'paid' })
    capture('checkout', { status: 'pending' })
    capture('checkout')
    expect(result.current).toEqual([])

    capture('checkout', { status: 'paid' })
    expect(result.current.map(({ id }) => id)).toEqual(['checkout-survey'])
    capture('survey shown', { $survey_id: 'checkout-survey' })
    expect(result.current).toEqual([])

    capture('reorder')
    expect(result.current).toHaveLength(1)
    reset()
    expect(result.current).toEqual([])
  })

  it('ignores browser-only action steps and still accepts a separate event trigger', () => {
    const { result, capture } = renderEligibleSurveys({
      actions: { values: [{ id: 1, steps: [{ event: 'checkout', selector: '#pay' }] }] },
      events: { values: [{ name: 'order confirmed' }] },
    })

    capture('checkout', { $element_selectors: ['#pay'] })
    expect(result.current).toEqual([])
    capture('order confirmed')
    expect(result.current).toHaveLength(1)
  })
})
