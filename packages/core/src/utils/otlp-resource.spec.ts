import { buildResourceAttributes } from '../logs/logs-utils'
import type { ResolvedPostHogLogsConfig } from '../logs/types'
import { buildMetricsResourceAttributes } from '../metrics/metrics-utils'
import type { ResolvedPostHogMetricsConfig } from '../metrics/types'
import { buildTracesResourceAttributes } from '../traces/otlp'
import type { ResolvedTracesConfig } from '../traces/types'

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
