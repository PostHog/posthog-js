import { describe, expect, test, jest } from '@jest/globals'
import { PostHog, normalizeError } from './index.js'
import type { BeforeSendFn, IdentifyFn } from './index.js'
import { LocalFeatureFlagEvaluator } from './feature-flags/index.js'

function mockSchedulerCtx() {
  return {
    scheduler: {
      runAfter: jest.fn(),
    },
  }
}

describe('PostHog client', () => {
  test('constructor accepts no options', () => {
    const posthog = new PostHog({} as never)
    expect(posthog).toBeInstanceOf(PostHog)
  })

  test('constructor accepts identify and beforeSend callbacks', () => {
    const posthog = new PostHog({} as never, {
      identify: async () => null,
      beforeSend: (event) => event,
    })
    expect(posthog).toBeInstanceOf(PostHog)
  })

  test('does not forward credentials to component calls (env-driven config)', async () => {
    // Credentials live on the component as env vars (POSTHOG_TOKEN, POSTHOG_HOST,
    // POSTHOG_PERSONAL_API_KEY) declared in convex.config.ts and read inside each action.
    // The client must not plumb them through every call site.
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'test-event',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args).not.toHaveProperty('apiKey')
    expect(args).not.toHaveProperty('host')
    expect(args).not.toHaveProperty('personalApiKey')
  })

  test('exposes capture, identify, groupIdentify, alias, captureException methods', () => {
    const posthog = new PostHog({} as never)

    expect(typeof posthog.capture).toBe('function')
    expect(typeof posthog.identify).toBe('function')
    expect(typeof posthog.groupIdentify).toBe('function')
    expect(typeof posthog.alias).toBe('function')
    expect(typeof posthog.captureException).toBe('function')
  })

  test('exposes feature flag methods', () => {
    const posthog = new PostHog({} as never)

    expect(typeof posthog.getFeatureFlag).toBe('function')
    expect(typeof posthog.isFeatureEnabled).toBe('function')
    expect(typeof posthog.getFeatureFlagPayload).toBe('function')
    expect(typeof posthog.getFeatureFlagResult).toBe('function')
    expect(typeof posthog.getAllFlags).toBe('function')
    expect(typeof posthog.getAllFlagsAndPayloads).toBe('function')
  })

  test('exposes refreshFlagDefinitions method', () => {
    const posthog = new PostHog({} as never)
    expect(typeof posthog.refreshFlagDefinitions).toBe('function')
  })

  test('refreshFlagDefinitions forwards to the component action with no args', async () => {
    const component = { lib: { refreshFlagDefinitions: 'refresh_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = { runAction: jest.fn(async () => ({ status: 'updated' })) }

    await posthog.refreshFlagDefinitions(ctx as never)

    expect(ctx.runAction).toHaveBeenCalledWith('refresh_ref', {})
  })

  test('getFeatureFlagPayload with matchValue does not require a distinctId', async () => {
    // The matchValue path is a pure key+value payload lookup; resolving a distinctId would
    // force callers to configure an identify callback or pass an ID they don't have.
    const definitions = JSON.stringify({
      flags: [
        {
          id: 1,
          name: 'flag',
          key: 'flag',
          deleted: false,
          active: true,
          rollout_percentage: null,
          ensure_experience_continuity: false,
          experiment_set: [],
          filters: {
            groups: [{ properties: [], rollout_percentage: 0 }],
            multivariate: { variants: [{ key: 'red', rollout_percentage: 100 }] },
            payloads: { red: 'red-payload' },
          },
        },
      ],
      groupTypeMapping: {},
      cohorts: {},
    })
    const component = { lib: { getFlagDefinitions: 'getFlagDefinitions_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = {
      runQuery: jest.fn(async () => ({ data: definitions, fetchedAt: Date.now() })),
    }

    const payload = await posthog.getFeatureFlagPayload(ctx as never, { key: 'flag', matchValue: 'red' })
    expect(payload).toBe('red-payload')
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
    const posthog = new PostHog(component as never)
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
    expect(args.additionalProperties).toBe(JSON.stringify({ context: 'signup' }))
  })

  test('handles string errors', async () => {
    const component = {
      lib: { captureException: 'captureException_ref' },
    }
    const posthog = new PostHog(component as never)
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

describe('$-prefixed property serialization', () => {
  test('serializes properties with $-prefixed keys as JSON strings', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: '$ai_generation',
      properties: {
        $ai_model: 'gpt-5-mini',
        $ai_provider: 'openai',
        $ai_input_tokens: 10,
        $ai_output_tokens: 20,
      },
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(typeof args.properties).toBe('string')
    expect(JSON.parse(args.properties)).toEqual({
      $ai_model: 'gpt-5-mini',
      $ai_provider: 'openai',
      $ai_input_tokens: 10,
      $ai_output_tokens: 20,
    })
  })

  test('serializes identify properties with $set and $set_once', async () => {
    const component = { lib: { identify: 'identify_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await posthog.identify(ctx as never, {
      distinctId: 'user-1',
      properties: {
        $set: { name: 'Alice' },
        $set_once: { created_at: '2026-01-01' },
      },
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(typeof args.properties).toBe('string')
    expect(JSON.parse(args.properties)).toEqual({
      $set: { name: 'Alice' },
      $set_once: { created_at: '2026-01-01' },
    })
  })

  test('passes undefined when properties are not provided', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'simple_event',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.properties).toBeUndefined()
  })

  test('preserves nested objects and arrays through serialization', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    const properties = {
      $ai_input: [{ role: 'user', content: 'Hello' }],
      $ai_output_choices: [{ role: 'assistant', content: 'Hi!' }],
      nested: { deep: { value: true } },
      numbers: [1, 2.5, -3],
      nullValue: null,
      boolValue: false,
    }

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: '$ai_generation',
      properties,
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(JSON.parse(args.properties)).toEqual(properties)
  })

  test('serializes groups with string and number values', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'test',
      groups: { company: 'acme', project_id: 42 },
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(typeof args.groups).toBe('string')
    expect(JSON.parse(args.groups)).toEqual({ company: 'acme', project_id: 42 })
  })

  test('serializes captureException additionalProperties', async () => {
    const component = { lib: { captureException: 'captureException_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await posthog.captureException(ctx as never, {
      error: new Error('test'),
      distinctId: 'user-1',
      additionalProperties: { $ai_trace_id: 'trace-123', page: '/checkout' },
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(typeof args.additionalProperties).toBe('string')
    expect(JSON.parse(args.additionalProperties)).toEqual({
      $ai_trace_id: 'trace-123',
      page: '/checkout',
    })
  })

  test('handles empty objects', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'test',
      properties: {},
      groups: {},
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(JSON.parse(args.properties)).toEqual({})
    expect(JSON.parse(args.groups)).toEqual({})
  })
})

describe('beforeSend', () => {
  test('allows events through when no beforeSend is configured', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
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
      beforeSend,
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'page_view',
      properties: { page: '/home' },
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.properties).toBe(JSON.stringify({ page: '/home', injected: true }))
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
      beforeSend: [fn1, fn2],
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'user-1',
      event: 'test',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.properties).toBe(JSON.stringify({ first: true, second: true }))
  })

  test('short-circuits chain when a function returns null', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const fn1: BeforeSendFn = () => null
    const fn2: BeforeSendFn = jest.fn((event) => event)
    const posthog = new PostHog(component as never, {
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
      identify: identifyReturningNull,
    })
    const ctx = mockSchedulerCtx()

    await expect(posthog.capture(ctx as never, { event: 'test_event' })).rejects.toThrow('Could not resolve distinctId')
  })

  test('throws when no identify configured and no explicit distinctId', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await expect(posthog.capture(ctx as never, { event: 'test_event' })).rejects.toThrow('Could not resolve distinctId')
  })

  test('identify callback takes precedence over explicit distinctId', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never, {
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
      identify,
    })
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, { event: 'test_event' })

    expect(identify).toHaveBeenCalledWith(ctx)
  })

  test('works with identify method', async () => {
    const component = { lib: { identify: 'identify_ref' } }
    const posthog = new PostHog(component as never, {
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
    const posthog = new PostHog(component as never)
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
    // Spy on the evaluator's `getFeatureFlag` so we can assert that the distinctId resolved by
    // the identify callback ('auth-user') is the one actually forwarded to evaluation.
    const evalSpy = jest.spyOn(LocalFeatureFlagEvaluator.prototype, 'getFeatureFlag').mockResolvedValue(true)
    try {
      const component = { lib: { getFlagDefinitions: 'getFlagDefinitions_ref' } }
      const posthog = new PostHog(component as never, {
        identify: identifyReturning('auth-user'),
      })
      // Stub real-looking flag definitions so `loadEvaluator` returns an instance.
      const definitions = {
        data: JSON.stringify({ flags: [], groupTypeMapping: {}, cohorts: {} }),
        fetchedAt: Date.now(),
      }
      const runQuery = jest.fn(async () => definitions)
      const ctx = { runQuery }

      await posthog.getFeatureFlag(ctx as never, { key: 'my-flag' })

      expect(runQuery).toHaveBeenCalledWith('getFlagDefinitions_ref', {})
      // The evaluator's getFeatureFlag(key, distinctId, groups, personProps, groupProps) — assert
      // we pass the auth-resolved id straight through.
      expect(evalSpy).toHaveBeenCalledWith('my-flag', 'auth-user', {}, {}, {})
    } finally {
      evalSpy.mockRestore()
    }
  })

  test('explicit distinctId still works without identify callback', async () => {
    const component = { lib: { capture: 'capture_ref' } }
    const posthog = new PostHog(component as never)
    const ctx = mockSchedulerCtx()

    await posthog.capture(ctx as never, {
      distinctId: 'explicit-user',
      event: 'test_event',
    })

    const [, , args] = ctx.scheduler.runAfter.mock.calls[0]
    expect(args.distinctId).toBe('explicit-user')
  })
})
