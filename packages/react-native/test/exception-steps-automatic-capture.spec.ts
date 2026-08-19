import { PostHog, PostHogCustomStorage } from '../src'
import { Linking, AppState } from 'react-native'
import { wait } from './test-utils'

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

const captureSpy = (posthog: PostHog): jest.SpyInstance => jest.spyOn(posthog as any, 'capture')

const exceptionSteps = (spy: jest.SpyInstance): any => {
  const call = spy.mock.calls.find(([event]) => event === '$exception')
  return call?.[1]?.$exception_steps
}

const messagesOf = (spy: jest.SpyInstance): string[] => (exceptionSteps(spy) ?? []).map((s: any) => s.$message)

// The automatic path runs inside enqueue, which a disabled client never reaches. So these tests use a
// live client, await ready(), and let the mocked fetch absorb the flush.
describe('PostHog React Native automatic exception steps capture', () => {
  jest.useRealTimers()

  let posthog: PostHog
  let cache: Record<string, any> = {}
  let mockStorage: PostHogCustomStorage

  beforeEach(() => {
    cache = {}
    mockStorage = {
      getItem: async (key) => cache[key] || null,
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
    ;(globalThis as any).window = (globalThis as any).window ?? {}
    ;(globalThis as any).window.fetch = jest.fn(async (url: unknown) => ({
      status: 200,
      json: () => Promise.resolve(String(url).includes('flags') ? { featureFlags: {} } : { status: 'ok' }),
    }))
  })

  afterEach(async () => {
    await posthog?.shutdown()
  })

  const newPostHog = async (options: Record<string, unknown> = {}): Promise<PostHog> => {
    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      flushInterval: 0,
      // Lifecycle events would add their own steps, so the exact-order tests opt out.
      captureAppLifecycleEvents: false,
      ...options,
    } as any)
    await posthog.ready()
    await wait(20)
    return posthog
  }

  it('attaches automatic steps for screens and taps, in order, alongside manual steps', async () => {
    await newPostHog({ errorTracking: { exceptionSteps: { automatic: true } } })
    const spy = captureSpy(posthog)

    await posthog.screen('Cart')
    posthog.autocapture('touch', [{ tag_name: 'CheckoutButton' }])
    posthog.addExceptionStep('Submitting payment')
    await wait(20)

    posthog.captureException(new Error('boom'))

    expect(messagesOf(spy)).toEqual(['Screen: Cart', 'Tap: CheckoutButton', 'Submitting payment'])
    expect(exceptionSteps(spy).map((s: any) => s.$type)).toEqual(['navigation', 'tap', undefined])
  })

  it('records a lifecycle step for an app state change', async () => {
    await newPostHog({
      captureAppLifecycleEvents: true,
      errorTracking: { exceptionSteps: { automatic: { lifecycle: true } } },
    })
    const spy = captureSpy(posthog)

    posthog.capture('Application Backgrounded')
    await wait(20)

    posthog.captureException(new Error('boom'))

    expect(messagesOf(spy)).toContain('Application Backgrounded')
  })

  it('leaves an ordinary analytics event out of the timeline', async () => {
    await newPostHog({ errorTracking: { exceptionSteps: { automatic: true } } })
    const spy = captureSpy(posthog)

    posthog.capture('Order Completed', { total: 12900 })
    await wait(20)

    posthog.captureException(new Error('boom'))

    expect(exceptionSteps(spy)).toBeUndefined()
  })

  it('records no automatic step when the caller enabled none', async () => {
    await newPostHog()
    const spy = captureSpy(posthog)

    await posthog.screen('Cart')
    await wait(20)

    posthog.captureException(new Error('boom'))

    expect(exceptionSteps(spy)).toBeUndefined()
  })

  it('drops buffered steps on reset, so one user never sees the previous user activity', async () => {
    await newPostHog({ errorTracking: { exceptionSteps: { automatic: true } } })
    const spy = captureSpy(posthog)

    await posthog.screen('Cart')
    posthog.addExceptionStep('Submitting payment')
    await wait(20)

    posthog.reset()

    posthog.captureException(new Error('boom'))

    expect(exceptionSteps(spy)).toBeUndefined()
  })

  it('records steps again after a reset', async () => {
    await newPostHog({ errorTracking: { exceptionSteps: { automatic: true } } })
    const spy = captureSpy(posthog)

    await posthog.screen('Cart')
    posthog.reset()
    await posthog.screen('Login')
    await wait(20)

    posthog.captureException(new Error('boom'))

    expect(messagesOf(spy)).toEqual(['Screen: Login'])
  })

  it('leaves no automatic step for an event that before_send dropped', async () => {
    await newPostHog({
      errorTracking: { exceptionSteps: { automatic: true } },
      before_send: (event: any) => (event.event === '$screen' ? null : event),
    })
    const spy = captureSpy(posthog)

    await posthog.screen('Cart')
    await wait(20)

    posthog.captureException(new Error('boom'))

    expect(exceptionSteps(spy)).toBeUndefined()
  })
})
