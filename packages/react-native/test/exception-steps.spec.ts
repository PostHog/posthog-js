import { ErrorTracking } from '../src/error-tracking'

// Prevent the autocapture handlers from registering real global handlers.
jest.mock('../src/error-tracking/utils', () => ({
  trackUncaughtExceptions: jest.fn(),
  trackUnhandledRejections: jest.fn(),
  trackConsole: jest.fn(),
}))

jest.mock('../src/utils', () => ({
  isHermes: jest.fn(() => false),
  getRemoteConfigBool: jest.requireActual('../src/utils').getRemoteConfigBool,
}))

import { createMockLogger, createMockPostHog } from './test-utils'

const mockPostHog = createMockPostHog()

const messagesOf = (et: ErrorTracking): unknown[] => et.getAttachableExceptionSteps().map((s) => s.$message)

describe('ErrorTracking exception steps', () => {
  let logger: ReturnType<typeof createMockLogger>

  beforeEach(() => {
    jest.clearAllMocks()
    logger = createMockLogger()
  })

  const newErrorTracking = (exceptionSteps?: { enabled?: boolean; maxBytes?: number }): ErrorTracking =>
    new ErrorTracking(mockPostHog, { exceptionSteps }, logger as any)

  it('records a step with $message, $timestamp and user properties', () => {
    const et = newErrorTracking()
    et.addExceptionStep('User tapped Checkout', { screen: 'cart' })

    const steps = et.getAttachableExceptionSteps()
    expect(steps).toHaveLength(1)
    expect(steps[0].$message).toBe('User tapped Checkout')
    expect(steps[0].screen).toBe('cart')
    expect(typeof steps[0].$timestamp).toBe('string')
  })

  it('preserves FIFO order across multiple steps', () => {
    const et = newErrorTracking()
    et.addExceptionStep('A')
    et.addExceptionStep('B')
    et.addExceptionStep('C')

    expect(messagesOf(et)).toEqual(['A', 'B', 'C'])
  })

  it('ignores empty, missing or non-string messages with a warning', () => {
    const et = newErrorTracking()
    et.addExceptionStep('')
    et.addExceptionStep('   ')
    et.addExceptionStep(undefined as any)
    et.addExceptionStep(42 as any)

    expect(et.getAttachableExceptionSteps()).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('strips reserved keys from user properties with a warning', () => {
    const et = newErrorTracking()
    et.addExceptionStep('step', { $message: 'spoofed', $timestamp: 'spoofed', keep: 'me' })

    const steps = et.getAttachableExceptionSteps()
    expect(steps[0].$message).toBe('step')
    expect(steps[0].$timestamp).not.toBe('spoofed')
    expect(steps[0].keep).toBe('me')
    expect(logger.warn).toHaveBeenCalledWith('Ignoring reserved exception step fields', {
      droppedKeys: expect.any(Array),
    })
  })

  it('is a no-op when disabled', () => {
    const et = newErrorTracking({ enabled: false })
    et.addExceptionStep('A')

    expect(et.getAttachableExceptionSteps()).toEqual([])
  })

  it('evicts the oldest steps when the byte budget is exceeded', () => {
    // Each serialized step is ~56 bytes ($message + ISO $timestamp), so a 130-byte budget holds
    // at most two and forces the oldest to be evicted on the third add.
    const et = newErrorTracking({ maxBytes: 130 })
    et.addExceptionStep('A')
    et.addExceptionStep('B')
    et.addExceptionStep('C')

    const messages = messagesOf(et)
    // The oldest steps are dropped; the most recent survive within budget.
    expect(messages).toContain('C')
    expect(messages).not.toContain('A')
  })

  it('rejects a single step larger than the budget and keeps existing steps', () => {
    const et = newErrorTracking({ maxBytes: 200 })
    et.addExceptionStep('keep')
    et.addExceptionStep('x'.repeat(1000))

    expect(messagesOf(et)).toEqual(['keep'])
  })

  it('clears the buffer on clearExceptionSteps', () => {
    const et = newErrorTracking()
    et.addExceptionStep('A')
    et.clearExceptionSteps()

    expect(et.getAttachableExceptionSteps()).toEqual([])
  })

  it('exposes the native-plugin config shape so the native layer can stay in sync', () => {
    const et = newErrorTracking({ maxBytes: 1024 })
    expect(et.getNativePluginExceptionStepsConfig()).toEqual({ enabled: true, maxBytes: 1024 })
  })

  it('returns whether the step was buffered (so the caller can skip native forwarding)', () => {
    const et = newErrorTracking()
    expect(et.addExceptionStep('valid')).toBe(true)
    expect(et.addExceptionStep('')).toBe(false)
    expect(et.addExceptionStep('   ')).toBe(false)

    const disabled = newErrorTracking({ enabled: false })
    expect(disabled.addExceptionStep('x')).toBe(false)
  })
})
