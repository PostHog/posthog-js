import { PostHog } from '../src'
import { ErrorTracking } from '../src/error-tracking'
import { Linking, AppState } from 'react-native'

// Mock the utils to prevent actual global handler registration
vi.mock('../src/error-tracking/utils', () => ({
  trackUncaughtExceptions: vi.fn(),
  trackUnhandledRejections: vi.fn(),
  trackConsole: vi.fn(),
}))

import { createMockLogger, createMockPostHog } from './test-utils'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()
vi.useRealTimers()

const exceptionList = (type: string, value: string): any[] => [{ type, value, mechanism: { handled: true } }]

const rule = (type: 'AND' | 'OR', ...values: [string, string, string | string[]][]): any => ({
  type,
  values: values.map(([key, operator, value]) => ({ key, operator, value, type: 'error_tracking_issue_property' })),
})

describe('ErrorTracking suppression rules', () => {
  const newErrorTracking = (): ErrorTracking =>
    new ErrorTracking(createMockPostHog(), { autocapture: false }, createMockLogger())

  it('does not suppress anything before remote config arrives', () => {
    const et = newErrorTracking()
    expect(et.shouldSuppressException(exceptionList('TypeError', 'boom'))).toBe(false)
  })

  it('suppresses an exception whose type matches', () => {
    const et = newErrorTracking()
    et.onRemoteConfig({ suppressionRules: [rule('AND', ['$exception_types', 'exact', 'TypeError'])] })

    expect(et.shouldSuppressException(exceptionList('TypeError', 'boom'))).toBe(true)
    expect(et.shouldSuppressException(exceptionList('RangeError', 'boom'))).toBe(false)
  })

  it('suppresses an exception whose value matches, case-insensitively', () => {
    const et = newErrorTracking()
    et.onRemoteConfig({ suppressionRules: [rule('AND', ['$exception_values', 'icontains', 'network request'])] })

    expect(et.shouldSuppressException(exceptionList('Error', 'Network Request Failed'))).toBe(true)
    expect(et.shouldSuppressException(exceptionList('Error', 'boom'))).toBe(false)
  })

  it('matches any of several target values', () => {
    const et = newErrorTracking()
    et.onRemoteConfig({ suppressionRules: [rule('AND', ['$exception_types', 'exact', ['TypeError', 'RangeError']])] })

    expect(et.shouldSuppressException(exceptionList('RangeError', 'boom'))).toBe(true)
  })

  it('requires every condition of an AND rule and any condition of an OR rule', () => {
    const conditions: [string, string, string][] = [
      ['$exception_types', 'exact', 'TypeError'],
      ['$exception_values', 'exact', 'boom'],
    ]
    const andTracking = newErrorTracking()
    andTracking.onRemoteConfig({ suppressionRules: [rule('AND', ...conditions)] })
    const orTracking = newErrorTracking()
    orTracking.onRemoteConfig({ suppressionRules: [rule('OR', ...conditions)] })

    expect(andTracking.shouldSuppressException(exceptionList('TypeError', 'other'))).toBe(false)
    expect(andTracking.shouldSuppressException(exceptionList('TypeError', 'boom'))).toBe(true)
    expect(orTracking.shouldSuppressException(exceptionList('TypeError', 'other'))).toBe(true)
  })

  it('keeps the rules when remote config has no errorTracking key', () => {
    const et = newErrorTracking()
    et.onRemoteConfig({ suppressionRules: [rule('AND', ['$exception_types', 'exact', 'TypeError'])] })
    et.onRemoteConfig(undefined)

    expect(et.shouldSuppressException(exceptionList('TypeError', 'boom'))).toBe(true)
  })

  it('clears the rules when a new errorTracking config has none', () => {
    const et = newErrorTracking()
    et.onRemoteConfig({ suppressionRules: [rule('AND', ['$exception_types', 'exact', 'TypeError'])] })
    et.onRemoteConfig({ autocaptureExceptions: true })

    expect(et.shouldSuppressException(exceptionList('TypeError', 'boom'))).toBe(false)
  })

  it('ignores malformed rules and unknown operators instead of throwing', () => {
    const et = newErrorTracking()
    et.onRemoteConfig({
      suppressionRules: ['nope', { type: 'AND' }, rule('AND', ['$exception_types', 'not_an_operator', 'TypeError'])],
    })

    expect(et.shouldSuppressException(exceptionList('TypeError', 'boom'))).toBe(false)
    expect(et.shouldSuppressException('not a list')).toBe(false)
  })

  it('records an exception step when it drops an exception', () => {
    const et = newErrorTracking()
    et.onRemoteConfig({ suppressionRules: [rule('AND', ['$exception_types', 'exact', 'TypeError'])] })

    et.shouldSuppressException(exceptionList('TypeError', 'boom'))

    expect(et.getAttachableExceptionSteps().map((s) => s.$message)).toEqual([
      'Exception dropped: matched a suppression rule',
    ])
  })
})

describe('PostHog React Native captureException with suppression rules', () => {
  const clients: PostHog[] = []

  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      status: 200,
      json: () => Promise.resolve({ featureFlags: {} }),
    })) as unknown as typeof fetch
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
  })

  const newPostHog = (): PostHog => {
    const client = new PostHog('test-token', { persistence: 'memory', flushInterval: 0, disabled: true } as any)
    clients.push(client)
    return client
  }

  it('drops a matching exception and captures the rest', () => {
    const posthog = newPostHog()
    const spy = vi.spyOn(posthog as any, 'capture')
    ;(posthog as any).onRemoteConfig({
      errorTracking: { suppressionRules: [rule('AND', ['$exception_types', 'exact', 'TypeError'])] },
    })

    posthog.captureException(new TypeError('ignored'))
    posthog.captureException(new RangeError('kept'))

    const exceptionCalls = spy.mock.calls.filter(([event]) => event === '$exception')
    expect(exceptionCalls).toHaveLength(1)
    const [, properties] = exceptionCalls[0] as [string, any]
    expect(properties.$exception_list[0].type).toBe('RangeError')
    expect(properties.$exception_steps.map((s: any) => s.$message)).toEqual([
      'Exception dropped: matched a suppression rule',
    ])
  })
})
