import { describe, expect, test, jest } from '@jest/globals'
import { PostHog, normalizeError } from './index.js'
import type { BeforeSendFn, IdentifyFn } from './index.js'

function mockSchedulerCtx() {
  return {
    scheduler: {
      runAfter: jest.fn(),
    },
  }
}

describe('PostHog client', () => {
  test('constructor uses defaults from env', () => {
    process.env.POSTHOG_API_KEY = 'test-key'
    process.env.POSTHOG_HOST = 'https://test.posthog.com'

    const posthog = new PostHog({} as never)
    expect(posthog).toBeInstanceOf(PostHog)

    delete process.env.POSTHOG_API_KEY
    delete process.env.POSTHOG_HOST
  })

  test('constructor accepts explicit options', () => {
    const posthog = new PostHog({} as never, {
      apiKey: 'explicit-key',
      host: 'https://custom.posthog.com',
    })
    expect(posthog).toBeInstanceOf(PostHog)
  })

  test('exposes capture, identify, groupIdentify, alias, captureException methods', () => {
    const posthog = new PostHog({} as never, { apiKey: 'test' })

    expect(typeof posthog.capture).toBe('function')
    expect(typeof posthog.identify).toBe('function')
    expect(typeof posthog.groupIdentify).toBe('function')
    expect(typeof posthog.alias).toBe('function')
    expect(typeof posthog.captureException).toBe('function')
  })

  test('exposes feature flag methods', () => {
    const posthog = new PostHog({} as never, { apiKey: 'test' })

    expect(typeof posthog.getFeatureFlag).toBe('function')
    expect(typeof posthog.isFeatureEnabled).toBe('function')
    expect(typeof posthog.getFeatureFlagPayload).toBe('function')
    expect(typeof posthog.getFeatureFlagResult).toBe('function')
    expect(typeof posthog.getAllFlags).toBe('function')
    expect(typeof posthog.getAllFlagsAndPayloads).toBe('function')
  })
})

describe('normalizeError', () => {
  test('extracts message, stack, and name from Error instances', () => {
    const error = new Error('test error')
    error.name = 'TestError'
    const result = normalizeError(error)

    expect(result.message).toBe('test error')
    expect(result.name).toBe('TestError')
    expect(result.stack).toBeDefined()
  })

  test('wraps string errors', () => {
    const result = normalizeError('something went wrong')

    expect(result.message).toBe('something went wrong')
    expect(result.stack).toBeUndefined()
    expect(result.name).toBeUndefined()
  })

  test('extracts from error-like objects', () => {
    const result = normalizeError({
      message: 'obj error',
      stack: 'at line 1',
      name: 'ObjError',
    })

    expect(result.message).toBe('obj error')
    expect(result.stack).toBe('at line 1')
    expect(result.name).toBe('ObjError')
  })

  test('ignores non-string stack/name on error-like objects', () => {
    const result = normalizeError({
      message: 'obj error',
      stack: 123,
      name: null,
    })

    expect(result.message).toBe('obj error')
    expect(result.stack).toBeUndefined()
    expect(result.name).toBeUndefined()
  })

  test('stringifies unknown values', () => {
    expect(normalizeError(42)).toEqual({ message: '42' })
    expect(normalizeError(null)).toEqual({ message: 'null' })
    expect(normalizeError(undefined)).toEqual({ message: 'undefined' })
  })
})

describe('captureException', () => {
  test('schedules captureException action with serialized error', async () => {
    const component = {
      lib: { captureException: 'captureException_ref' },
    }
    const posthog = new PostHog(component as never, { apiKey: 'key' })
    const ctx = mockSchedulerCtx()

    await posthog.captureException(ctx as never, {
      error: new TypeError('bad type'),
      distinctId: 'user-1',
      additionalProperties: { context: 'signup' },
    })

    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1)
    const [delay, ref, args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(delay).toBe(0)
    expect(ref).toBe('captureException_ref')
    expect(args.errorMessage).toBe('bad type')
    expect(args.errorName).toBe('TypeError')
    expect(args.errorStack).toBeDefined()
    expect(args.distinctId).toBe('user-1')
    expect(args.additionalProperties).toEqual({ context: 'signup' })
  })

  test('handles string errors', async () => {
    const component = {
      lib: { captureException: 'captureException_ref' },
    }
    const posthog = new PostHog(component as never, { apiKey: 'key' })
    const ctx = mockSchedulerCtx()

    await posthog.captureException(ctx as never, {
      error: 'string error',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.errorMessage).toBe('string error')
    expect(args.errorStack).toBeUndefined()
    expect(args.errorName).toBeUndefined()
  })
})

describe('beforeSend', () => {
  test('allows events through when no beforeSend is configured', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never, { apiKey: 'key' })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'page_view',
    })

    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1)
  })

  test('blocks events when beforeSend returns null', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const beforeSend: BeforeSendFn = () => null
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      beforeSend,
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'page_view',
    })

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled()
  })

  test('modifies event properties via beforeSend', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const beforeSend: BeforeSendFn = (event) => ({
      ...event,
      properties: { ...event.properties, injected: true },
    })
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      beforeSend,
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'page_view',
      properties: { page: '/home' },
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.properties).toEqual({ page: '/home', injected: true })
  })

  test('chains multiple beforeSend functions', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const fn1: BeforeSendFn = (event) => ({
      ...event,
      properties: { ...event.properties, first: true },
    })
    const fn2: BeforeSendFn = (event) => ({
      ...event,
      properties: { ...event.properties, second: true },
    })
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      beforeSend: [fn1, fn2],
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'test',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.properties).toEqual({ first: true, second: true })
  })

  test('short-circuits chain when a function returns null', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const fn1: BeforeSendFn = () => null
    const fn2: BeforeSendFn = jest.fn((event) => event)
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      beforeSend: [fn1, fn2],
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'test',
    })

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled()
    expect(fn2).not.toHaveBeenCalled()
  })

  test('applies beforeSend to identify events', async () => {
    const component = { lib: { identify: 'identify_ref' } }
    const beforeSend: BeforeSendFn = (event) => {
      expect(event.event).toBe('$identify')
      return null
    }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      beforeSend,
    })
    const ctx = mockSchedulerCtx()

    await posthog.identify(ctx as never, {
      distinctId: 'user-1',
    })

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled()
  })

  test('applies beforeSend to alias events', async () => {
    const component = { lib: { alias: 'alias_ref' } }
    const beforeSend: BeforeSendFn = (event) => {
      expect(event.event).toBe('$create_alias')
      return event
    }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      beforeSend,
    })
    const ctx = mockSchedulerCtx()

    await posthog.alias(ctx as never, {
      distinctId: 'user-1',
      alias: 'alias-1',
    })

    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1)
  })

  test('applies beforeSend to captureException events', async () => {
    const component = {
      lib: { captureException: 'captureException_ref' },
    }
    const beforeSend: BeforeSendFn = (event) => {
      expect(event.event).toBe('$exception')
      return null
    }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      beforeSend,
    })
    const ctx = mockSchedulerCtx()

    await posthog.captureException(ctx as never, {
      error: new Error('test'),
    })

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled()
  })

  test('applies beforeSend to groupIdentify events', async () => {
    const component = {
      lib: { groupIdentify: 'groupIdentify_ref' },
    }
    const beforeSend: BeforeSendFn = (event) => {
      expect(event.event).toBe('$groupidentify')
      return event
    }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      beforeSend,
    })
    const ctx = mockSchedulerCtx()

    await posthog.groupIdentify(ctx as never, {
      groupType: 'company',
      groupKey: 'acme',
    })

    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1)
  })
})

describe('identify callback', () => {
  const identifyReturning: (distinctId: string) => IdentifyFn = (distinctId) => async () => ({ distinctId })

  const identifyReturningNull: IdentifyFn = async () => null

  test('uses identify callback result for capture', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify: identifyReturning('auth-user-1'),
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, { event: 'test_event' })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBe('auth-user-1')
  })

  test('falls back to explicit distinctId when identify returns null', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify: identifyReturningNull,
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'explicit-user',
      event: 'test_event',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBe('explicit-user')
  })

  test('throws when neither identify nor explicit distinctId resolves', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify: identifyReturningNull,
    })
    const ctx = mockSchedulerCtx()

    await expect(posthog.capture(ctx as never, { event: 'test_event' })).rejects.toThrow('Could not resolve distinctId')
  })

  test('throws when no identify configured and no explicit distinctId', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never, { apiKey: 'key' })
    const ctx = mockSchedulerCtx()

    await expect(posthog.capture(ctx as never, { event: 'test_event' })).rejects.toThrow('Could not resolve distinctId')
  })

  test('identify callback takes precedence over explicit distinctId', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify: identifyReturning('auth-user'),
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'explicit-user',
      event: 'test_event',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBe('auth-user')
  })

  test('passes ctx to identify callback', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const identify = jest.fn(async () => ({ distinctId: 'resolved' }))
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify,
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, { event: 'test_event' })

    expect(identify).toHaveBeenCalledWith(ctx)
  })

  test('works with identify method', async () => {
    const component = { lib: { identify: 'identify_ref' } }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify: identifyReturning('auth-user'),
    })
    const ctx = mockSchedulerCtx()

    await posthog.identify(ctx as never, {})

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBe('auth-user')
  })

  test('works with alias method', async () => {
    const component = { lib: { alias: 'alias_ref' } }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify: identifyReturning('auth-user'),
    })
    const ctx = mockSchedulerCtx()

    await posthog.alias(ctx as never, { alias: 'new-alias' })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBe('auth-user')
  })

  test('captureException works without distinctId when identify is not configured', async () => {
    const component = {
      lib: { captureException: 'captureException_ref' },
    }
    const posthog = new PostHog(component as never, { apiKey: 'key' })
    const ctx = mockSchedulerCtx()

    await posthog.captureException(ctx as never, {
      error: new Error('test'),
    })

    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1)
    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBeUndefined()
  })

  test('captureException uses identify callback when available', async () => {
    const component = {
      lib: { captureException: 'captureException_ref' },
    }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify: identifyReturning('auth-user'),
    })
    const ctx = mockSchedulerCtx()

    await posthog.captureException(ctx as never, {
      error: new Error('test'),
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBe('auth-user')
  })

  test('works with feature flag methods', async () => {
    const component = { lib: { getFeatureFlag: 'getFeatureFlag_ref' } }
    const posthog = new PostHog(component as never, {
      apiKey: 'key',
      identify: identifyReturning('auth-user'),
    })
    const ctx = {
      runAction: jest.fn(async (_ref: unknown, _args: Record<string, unknown>) => true),
    }

    await posthog.getFeatureFlag(ctx as never, { key: 'my-flag' })

    const [, args] = ctx.runAction.mock.calls[0]
    expect(args.distinctId).toBe('auth-user')
  })

  test('explicit distinctId still works without identify callback', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never, { apiKey: 'key' })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'explicit-user',
      event: 'test_event',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBe('explicit-user')
  })
})
