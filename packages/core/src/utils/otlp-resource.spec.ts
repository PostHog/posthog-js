import { buildResourceAttributes } from '../logs/logs-utils'
import type { ResolvedPostHogLogsConfig } from '../logs/types'
import { buildMetricsResourceAttributes } from '../metrics/metrics-utils'
import type { ResolvedPostHogMetricsConfig } from '../metrics/types'
import { buildTracesResourceAttributes } from '../traces/otlp'
import type { ResolvedTracesConfig } from '../traces/types'
import { normalizeOsName, osResourceAttributes } from './otlp-resource'

const shared = {
  serviceName: 'checkout',
  serviceVersion: '2.1.0',
  environment: 'production',
  resourceAttributes: { 'host.name': 'web-01' },
}

const conflicting = {
  serviceName: 'checkout',
  serviceVersion: '2.1.0',
  environment: 'production',
  resourceAttributes: {
    'service.name': 'hijacked',
    'service.version': '0.0.0',
    'deployment.environment': 'hijacked-env',
    'telemetry.sdk.name': 'hijacked-sdk',
    'telemetry.sdk.version': '0.0.0',
    'host.name': 'web-01',
  },
}

const allThree = (partial: object): Record<string, unknown>[] => [
  buildResourceAttributes(partial as ResolvedPostHogLogsConfig, 'posthog-node', '1.0.0'),
  buildMetricsResourceAttributes(partial as ResolvedPostHogMetricsConfig, 'posthog-node', '1.0.0'),
  buildTracesResourceAttributes(partial as ResolvedTracesConfig, 'posthog-node', '1.0.0'),
]

describe('shared OTLP resource attributes', () => {
  it.each([
    ['a fully populated config', shared],
    ['a config with conflicting user attributes', conflicting],
    ['an empty config', {}],
  ])('produces the same attributes for logs, metrics and traces given %s', (_label, config) => {
    const [logs, metrics, traces] = allThree(config)
    expect(metrics).toEqual(logs)
    expect(traces).toEqual(logs)
    expect(Object.keys(metrics)).toEqual(Object.keys(logs))
    expect(Object.keys(traces)).toEqual(Object.keys(logs))
  })

  it('layers the identity keys over user resource attributes', () => {
    for (const attributes of allThree(conflicting)) {
      expect(attributes).toEqual({
        'service.name': 'checkout',
        'service.version': '2.1.0',
        'deployment.environment': 'production',
        'telemetry.sdk.name': 'posthog-node',
        'telemetry.sdk.version': '1.0.0',
        'host.name': 'web-01',
      })
    }
  })

  it('keeps user resource attributes that do not collide', () => {
    for (const attributes of allThree(shared)) {
      expect(attributes).toEqual({
        'host.name': 'web-01',
        'service.name': 'checkout',
        'deployment.environment': 'production',
        'service.version': '2.1.0',
        'telemetry.sdk.name': 'posthog-node',
        'telemetry.sdk.version': '1.0.0',
      })
    }
  })

  it('falls back to unknown_service and omits unset optional keys', () => {
    for (const attributes of allThree({})) {
      expect(attributes).toEqual({
        'service.name': 'unknown_service',
        'telemetry.sdk.name': 'posthog-node',
        'telemetry.sdk.version': '1.0.0',
      })
    }
  })
})

describe('osResourceAttributes', () => {
  it.each([
    // node:os platform() identifiers rather than os.name values
    ['darwin', 'macOS'],
    ['win32', 'Windows'],
    ['linux', 'Linux'],
    ['android', 'Android'],
    ['freebsd', 'FreeBSD'],
    ['openbsd', 'OpenBSD'],
    ['netbsd', 'NetBSD'],
    ['sunos', 'SunOS'],
    ['aix', 'AIX'],
    ['haiku', 'Haiku'],
    ['cygwin', 'Windows'],
    // detectOS spellings
    ['Mac OS X', 'macOS'],
    ['iOS', 'iOS'],
    ['Android', 'Android'],
    ['Windows', 'Windows'],
    ['Linux', 'Linux'],
  ])('normalizes %s to %s', (raw, expected) => {
    expect(normalizeOsName(raw)).toBe(expected)
  })

  it('passes an unmapped name through rather than dropping it', () => {
    expect(normalizeOsName('Plan 9')).toBe('Plan 9')
    expect(normalizeOsName('constructor')).toBe('constructor')
  })

  it.each([undefined, ''])('returns undefined for %p', (raw) => {
    expect(normalizeOsName(raw)).toBeUndefined()
  })

  it('agrees with the names posthog-ios and posthog-android already send', () => {
    // Both SDKs ship these values today; a divergence here splits one filter in two.
    expect(normalizeOsName('darwin')).toBe('macOS')
    expect(normalizeOsName('Mac OS X')).toBe('macOS')
    expect(normalizeOsName('iOS')).toBe('iOS')
    expect(normalizeOsName('Android')).toBe('Android')
  })

  it('omits either key rather than emitting it empty', () => {
    expect(osResourceAttributes('darwin', undefined)).toEqual({ 'os.name': 'macOS' })
    expect(osResourceAttributes(undefined, '14.0')).toEqual({ 'os.version': '14.0' })
    expect(osResourceAttributes('', '')).toEqual({})
    expect(osResourceAttributes('win32', '10.0.26100')).toEqual({
      'os.name': 'Windows',
      'os.version': '10.0.26100',
    })
  })
})
