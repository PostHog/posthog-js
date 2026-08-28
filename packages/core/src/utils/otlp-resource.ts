import { assignUserAttributes } from '../traces/sanitize'

/**
 * Shape the logs, metrics and traces resolved configs share for resource
 * attribution. Generic over the attribute value type so each signal keeps its
 * own value union.
 */
export interface OtlpResourceConfig<TAttributeValue> {
  serviceName?: string
  serviceVersion?: string
  environment?: string
  resourceAttributes?: Record<string, TAttributeValue>
}

/**
 * OTLP resource attributes shared by the logs, metrics and traces envelopes.
 *
 * User `resourceAttributes` are spread first, then SDK-controlled keys on top so
 * a stray user key can't clobber the ingestion-attribution ones; the dedicated
 * `serviceName` / `environment` / `serviceVersion` fields are how you override
 * those three.
 *
 * @internal Shared within this SDK; not part of the stable public API.
 */
export function buildOtlpResourceAttributes<TAttributeValue>(
  config: OtlpResourceConfig<TAttributeValue>,
  sdkName: string,
  sdkVersion: string
): Record<string, TAttributeValue | string> {
  return {
    // Read key by key: a throwing accessor on a user-supplied attribute runs on
    // every flush, before the pipeline's own error handling, and would otherwise
    // stop the signal exporting entirely.
    ...assignUserAttributes<Record<string, TAttributeValue>>({}, config.resourceAttributes),
    'service.name': config.serviceName || 'unknown_service',
    ...(config.environment && { 'deployment.environment': config.environment }),
    ...(config.serviceVersion && { 'service.version': config.serviceVersion }),
    'telemetry.sdk.name': sdkName,
    'telemetry.sdk.version': sdkVersion,
  }
}
