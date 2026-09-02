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

/**
 * OTLP `os.name` values, keyed by the spellings the JS SDKs detect natively:
 * `node:os` `platform()` identifiers and the names `detectOS` reads out of a
 * user agent.
 *
 * OpenTelemetry defines `os.name` as the human-readable OS name; the lowercase
 * identifiers (`darwin`, `win32`) are `node:os` `platform()` values, not
 * `os.name` values.
 * The values match what `posthog-ios` and `posthog-android` send for the
 * platforms they cover.
 */
const OS_NAMES: Record<string, string> = {
  // node:os platform(), all eleven of them
  darwin: 'macOS',
  win32: 'Windows',
  // Cygwin is a POSIX layer over Windows, so it belongs under the same filter.
  cygwin: 'Windows',
  linux: 'Linux',
  android: 'Android',
  freebsd: 'FreeBSD',
  openbsd: 'OpenBSD',
  netbsd: 'NetBSD',
  sunos: 'SunOS',
  aix: 'AIX',
  haiku: 'Haiku',
  // detectOS
  'Mac OS X': 'macOS',
}

/**
 * Normalizes a natively-detected OS name against the table above.
 * Unrecognized names pass through: a wrong-looking value beats dropping an OS
 * we have not mapped yet.
 *
 * @internal Shared within this SDK; not part of the stable public API.
 */
export function normalizeOsName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined
  }
  return Object.prototype.hasOwnProperty.call(OS_NAMES, name) ? OS_NAMES[name] : name
}

/**
 * The `os.name` / `os.version` resource attribute pair, with either key omitted
 * rather than emitted empty when the host cannot determine it.
 *
 * @internal Exposed for cross-package use within this SDK; not part of the stable public API.
 */
export function osResourceAttributes(name: string | undefined, version: string | undefined): Record<string, string> {
  const osName = normalizeOsName(name)
  return {
    ...(osName ? { 'os.name': osName } : {}),
    ...(version ? { 'os.version': version } : {}),
  }
}
