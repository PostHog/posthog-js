import { PostHog } from '../src'
import { Linking, AppState } from 'react-native'

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

const newPostHog = (errorTracking?: Record<string, unknown>): PostHog =>
  new PostHog('test-token', { persistence: 'memory', flushInterval: 0, errorTracking } as any)

const captureSpy = (posthog: PostHog): jest.SpyInstance => jest.spyOn(posthog as any, 'capture')

const lastExceptionSteps = (spy: jest.SpyInstance): any => {
  const call = spy.mock.calls.find(([event]) => event === '$exception')
  return call?.[1]?.$exception_steps
}

describe('PostHog React Native exception steps capture', () => {
  // The attach happens synchronously inside capture(), so these tests avoid ready()/flush
  // (which depend on timers that are faked in this suite).
  it('attaches buffered steps to a captured exception in order', () => {
    const posthog = newPostHog()
    const spy = captureSpy(posthog)

    posthog.addExceptionStep('A')
    posthog.addExceptionStep('B', { screen: 'cart' })
    posthog.captureException(new Error('boom'))

    const steps = lastExceptionSteps(spy)
    expect(steps.map((s: any) => s.$message)).toEqual(['A', 'B'])
    expect(steps[1].screen).toBe('cart')
  })

  it('keeps the buffer across captures (rolling window)', () => {
    const posthog = newPostHog()
    const spy = captureSpy(posthog)

    posthog.addExceptionStep('A')
    posthog.captureException(new Error('first'))
    posthog.addExceptionStep('B')
    posthog.captureException(new Error('second'))

    const exceptionCalls = spy.mock.calls.filter(([event]) => event === '$exception')
    expect(exceptionCalls[0][1].$exception_steps.map((s: any) => s.$message)).toEqual(['A'])
    expect(exceptionCalls[1][1].$exception_steps.map((s: any) => s.$message)).toEqual(['A', 'B'])
  })

  it('does not overwrite caller-provided $exception_steps', () => {
    const posthog = newPostHog()
    const spy = captureSpy(posthog)

    posthog.addExceptionStep('buffered')
    posthog.captureException(new Error('boom'), { $exception_steps: [{ $message: 'caller' }] } as any)

    const steps = lastExceptionSteps(spy)
    expect(steps.map((s: any) => s.$message)).toEqual(['caller'])
  })

  it('attaches nothing when disabled', () => {
    const posthog = newPostHog({ exceptionSteps: { enabled: false } })
    const spy = captureSpy(posthog)

    posthog.addExceptionStep('A')
    posthog.captureException(new Error('boom'))

    expect(lastExceptionSteps(spy)).toBeUndefined()
  })
})
