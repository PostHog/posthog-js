import { ErrorTracking, ExceptionStepsOptions } from '../src/error-tracking'
import {
  buildAutomaticExceptionStep,
  resolveAutomaticExceptionStepsOptions,
} from '../src/error-tracking/automatic-steps'

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

const ALL_ON = resolveAutomaticExceptionStepsOptions(true)

const touchProperties = (elements: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  $event_type: 'touch',
  $elements: elements,
  ...extra,
})

describe('buildAutomaticExceptionStep', () => {
  it('maps $screen to a navigation step', () => {
    expect(buildAutomaticExceptionStep(ALL_ON, '$screen', { $screen_name: 'Cart' })).toEqual({
      type: 'navigation',
      message: 'Screen: Cart',
    })
  })

  it('ignores $screen without a usable screen name', () => {
    expect(buildAutomaticExceptionStep(ALL_ON, '$screen', {})).toBeUndefined()
    expect(buildAutomaticExceptionStep(ALL_ON, '$screen', { $screen_name: '  ' })).toBeUndefined()
    expect(buildAutomaticExceptionStep(ALL_ON, '$screen', { $screen_name: 42 })).toBeUndefined()
  })

  it('labels a tap from the innermost autocaptured element', () => {
    const step = buildAutomaticExceptionStep(
      ALL_ON,
      '$autocapture',
      touchProperties([{ tag_name: 'CheckoutButton' }, { tag_name: 'CartScreen' }])
    )

    expect(step).toEqual({ type: 'tap', message: 'Tap: CheckoutButton' })
  })

  it('records an unlabelled tap when no element carries a label', () => {
    expect(buildAutomaticExceptionStep(ALL_ON, '$autocapture', touchProperties([]))).toEqual({
      type: 'tap',
      message: 'Tap',
    })
    expect(buildAutomaticExceptionStep(ALL_ON, '$autocapture', touchProperties([{ $el_text: 'Pay now' }]))).toEqual({
      type: 'tap',
      message: 'Tap',
    })
  })

  it('never puts element text or touch coordinates in a tap step', () => {
    const step = buildAutomaticExceptionStep(
      ALL_ON,
      '$autocapture',
      touchProperties([{ tag_name: 'PayButton', $el_text: 'Pay $129.00' }], { $touch_x: 120, $touch_y: 480 })
    )

    expect(step).toEqual({ type: 'tap', message: 'Tap: PayButton' })
    expect(JSON.stringify(step)).not.toContain('129.00')
    expect(JSON.stringify(step)).not.toContain('120')
  })

  it('records an unlabelled tap when the element list holds no usable element', () => {
    expect(buildAutomaticExceptionStep(ALL_ON, '$autocapture', touchProperties([null]))).toEqual({
      type: 'tap',
      message: 'Tap',
    })
    expect(buildAutomaticExceptionStep(ALL_ON, '$autocapture', { $event_type: 'touch', $elements: 'nope' })).toEqual({
      type: 'tap',
      message: 'Tap',
    })
  })

  it('ignores an autocaptured event that is not a touch', () => {
    expect(
      buildAutomaticExceptionStep(ALL_ON, '$autocapture', { $event_type: 'change', $elements: [{ tag_name: 'Input' }] })
    ).toBeUndefined()
  })

  it.each([
    'Application Installed',
    'Application Updated',
    'Application Opened',
    'Application Became Active',
    'Application Backgrounded',
  ])('maps the lifecycle event %s to a lifecycle step', (event) => {
    expect(buildAutomaticExceptionStep(ALL_ON, event, {})).toEqual({ type: 'lifecycle', message: event })
  })

  it('ignores an event that maps to no signal', () => {
    expect(buildAutomaticExceptionStep(ALL_ON, 'Order Completed', { total: 12900 })).toBeUndefined()
    expect(buildAutomaticExceptionStep(ALL_ON, '$exception', {})).toBeUndefined()
    expect(buildAutomaticExceptionStep(ALL_ON, undefined, {})).toBeUndefined()
  })

  it('records only the signals the caller enabled', () => {
    const navigationOnly = resolveAutomaticExceptionStepsOptions({ navigation: true })

    expect(buildAutomaticExceptionStep(navigationOnly, '$screen', { $screen_name: 'Cart' })).toBeDefined()
    expect(buildAutomaticExceptionStep(navigationOnly, '$autocapture', touchProperties([]))).toBeUndefined()
    expect(buildAutomaticExceptionStep(navigationOnly, 'Application Opened', {})).toBeUndefined()
  })

  it('records nothing when no signal is enabled', () => {
    const allOff = resolveAutomaticExceptionStepsOptions()

    expect(buildAutomaticExceptionStep(allOff, '$screen', { $screen_name: 'Cart' })).toBeUndefined()
    expect(buildAutomaticExceptionStep(allOff, '$autocapture', touchProperties([]))).toBeUndefined()
    expect(buildAutomaticExceptionStep(allOff, 'Application Opened', {})).toBeUndefined()
  })
})

describe('ErrorTracking automatic exception steps', () => {
  let logger: ReturnType<typeof createMockLogger>

  beforeEach(() => {
    jest.clearAllMocks()
    logger = createMockLogger()
  })

  const newErrorTracking = (exceptionSteps?: ExceptionStepsOptions): ErrorTracking =>
    new ErrorTracking(mockPostHog, { exceptionSteps }, logger as any)

  it('is off by default', () => {
    const et = newErrorTracking()
    et.onEnqueuedEvent('$screen', { $screen_name: 'Cart' })

    expect(et.automaticExceptionStepsEnabled).toBe(false)
    expect(et.getAttachableExceptionSteps()).toEqual([])
  })

  it('buffers a step with $type, $message and $timestamp', () => {
    const et = newErrorTracking({ automatic: true })
    et.onEnqueuedEvent('$screen', { $screen_name: 'Cart' })

    const steps = et.getAttachableExceptionSteps()
    expect(steps).toHaveLength(1)
    expect(steps[0].$type).toBe('navigation')
    expect(steps[0].$message).toBe('Screen: Cart')
    expect(typeof steps[0].$timestamp).toBe('string')
  })

  it('keeps automatic and manual steps in one ordered buffer', () => {
    const et = newErrorTracking({ automatic: true })
    et.onEnqueuedEvent('Application Opened', {})
    et.addExceptionStep('Loaded cart')
    et.onEnqueuedEvent('$screen', { $screen_name: 'Checkout' })

    expect(et.getAttachableExceptionSteps().map((s) => s.$message)).toEqual([
      'Application Opened',
      'Loaded cart',
      'Screen: Checkout',
    ])
  })

  it('leaves a manual step untyped so the timeline only labels automatic steps', () => {
    const et = newErrorTracking({ automatic: true })
    et.addExceptionStep('Loaded cart')

    expect(et.getAttachableExceptionSteps()[0].$type).toBeUndefined()
  })

  it('records nothing when exception steps are disabled', () => {
    const et = newErrorTracking({ enabled: false, automatic: true })
    et.onEnqueuedEvent('$screen', { $screen_name: 'Cart' })

    expect(et.getAttachableExceptionSteps()).toEqual([])
  })

  it('enables single signals from an object config', () => {
    const et = newErrorTracking({ automatic: { taps: true } })
    et.onEnqueuedEvent('$screen', { $screen_name: 'Cart' })
    et.onEnqueuedEvent('$autocapture', touchProperties([{ tag_name: 'PayButton' }]))

    expect(et.automaticExceptionStepsEnabled).toBe(true)
    expect(et.getAttachableExceptionSteps().map((s) => s.$message)).toEqual(['Tap: PayButton'])
  })

  it('evicts the oldest automatic steps once the byte budget is exceeded', () => {
    const et = newErrorTracking({ automatic: true, maxBytes: 200 })
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
      et.onEnqueuedEvent('$screen', { $screen_name: name })
    }

    const messages = et.getAttachableExceptionSteps().map((s) => s.$message)
    expect(messages).toContain('Screen: Six')
    expect(messages).not.toContain('Screen: One')
  })

  it('never throws out of the capture path', () => {
    const et = newErrorTracking({ automatic: true })
    const throwingProperties = {
      get $screen_name() {
        throw new Error('property read failed')
      },
    }

    expect(() => et.onEnqueuedEvent('$screen', throwingProperties)).not.toThrow()
    expect(logger.error).toHaveBeenCalled()
    expect(et.getAttachableExceptionSteps()).toEqual([])
  })
})
