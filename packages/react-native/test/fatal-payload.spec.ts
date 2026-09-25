import { buildFatalExceptionPayload } from '../src/error-tracking/fatal-payload'

const FATAL_PAYLOAD_MAX_BYTES = 64 * 1024
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength

const build = (overrides: Partial<Parameters<typeof buildFatalExceptionPayload>[0]> = {}) =>
  buildFatalExceptionPayload({
    timestamp: '2026-09-21T09:00:00.000Z',
    distinctId: 'distinct-id',
    properties: {
      $session_id: 'session-id',
      $device_id: 'device-id',
      $app_version: '1.2.3',
      $exception_list: [{ type: 'Error', value: 'boom' }],
      $exception_level: 'fatal',
    },
    ...overrides,
  })

describe('fatal exception payload', () => {
  it('carries the crash-time properties native cannot reconstruct itself', () => {
    const payload = build({
      properties: {
        $exception_list: [{ type: 'Error', value: 'boom' }],
        $exception_level: 'fatal',
        $app_state: 'active',
        $expo_update_id: 'update-1',
        custom: 'kept',
      },
    })

    expect(payload.distinctId).toBe('distinct-id')
    expect(payload.timestamp).toBe('2026-09-21T09:00:00.000Z')
    expect(payload.properties.$app_state).toBe('active')
    expect(payload.properties.$expo_update_id).toBe('update-1')
    expect(payload.properties.custom).toBe('kept')
  })

  it('always marks the event fatal so native takes its synchronous-persist path', () => {
    // Native keys its fatal fast path off this exact value; without it the record is queued
    // asynchronously and the process can die before it reaches disk.
    expect(build().properties.$exception_level).toBe('fatal')
    expect(
      build({
        properties: { $exception_list: [{ type: 'Error', value: 'boom' }] },
      }).properties.$exception_level
    ).toBe('fatal')
  })

  it('bounds every variable collection and the complete UTF-8 payload', () => {
    const large = '🔥'.repeat(40_000)
    const payload = build({
      properties: {
        $exception_list: Array.from({ length: 80 }, () => ({ type: 'Error', value: large })),
        $exception_steps: Array.from({ length: 200 }, () => ({ message: large })),
        $exception_level: 'fatal',
        bloat: large,
      },
    })

    expect((payload.properties.$exception_list as unknown[]).length).toBeLessThanOrEqual(32)
    expect((payload.properties.$exception_steps as unknown[] | undefined)?.length ?? 0).toBeLessThanOrEqual(64)
    expect(utf8Bytes(JSON.stringify(payload))).toBeLessThanOrEqual(FATAL_PAYLOAD_MAX_BYTES)
  })

  it('drops properties that are not JSON-safe rather than failing the whole capture', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const payload = build({
      properties: {
        $exception_list: [{ type: 'Error', value: 'boom' }],
        $exception_level: 'fatal',
        cyclic,
        fn: () => undefined,
        nan: Number.NaN,
        kept: 'yes',
      } as never,
    })

    expect(payload.properties.cyclic).toBeUndefined()
    expect(payload.properties.fn).toBeUndefined()
    expect(payload.properties.nan).toBeUndefined()
    expect(payload.properties.kept).toBe('yes')
  })

  it('keeps session and release attribution when a large flag set fills the budget', () => {
    // boundedObject fills in key order, so without an explicit priority a big `$feature/*`
    // set pushes whatever sorts after it off the end — including the session linkage and
    // release attribution a crash report is useless without.
    const properties: Record<string, unknown> = {}
    for (let i = 0; i < 150; i++) {
      properties[`$feature/experiment-with-a-realistic-name-${i}`] = `variant-${i}`
    }
    properties.$exception_list = [{ type: 'Error', value: 'boom' }]
    properties.$exception_level = 'fatal'
    properties.$session_id = '0192f1c2-7777-7abc-9def-0123456789ab'
    properties.$app_version = '1.2.3'
    properties.$lib_version = '4.68.4'
    properties.$process_person_profile = false
    properties.$app_state = 'active'

    const payload = build({ properties: properties as never })

    expect(payload.properties.$session_id).toBe('0192f1c2-7777-7abc-9def-0123456789ab')
    expect(payload.properties.$app_version).toBe('1.2.3')
    expect(payload.properties.$lib_version).toBe('4.68.4')
    expect(payload.properties.$process_person_profile).toBe(false)
    expect(payload.properties.$app_state).toBe('active')
    // Bulk properties are what the budget costs, and some flags do get dropped.
    const keptFlags = Object.keys(payload.properties).filter((k) => k.startsWith('$feature/'))
    expect(keptFlags.length).toBeGreaterThan(0)
    expect(keptFlags.length).toBeLessThan(150)
  })

  it('refuses a payload with no usable exception list', () => {
    expect(() => build({ properties: { $exception_level: 'fatal' } })).toThrow('$exception_list')
    expect(() => build({ properties: { $exception_list: [], $exception_level: 'fatal' } })).toThrow('$exception_list')
    expect(() => build({ properties: { $exception_list: ['nope'], $exception_level: 'fatal' } as never })).toThrow(
      '$exception_list'
    )
  })

  it('requires a timestamp so the crash is never attributed to the relaunch', () => {
    expect(() => build({ timestamp: '' })).toThrow('timestamp is required')
  })
})
