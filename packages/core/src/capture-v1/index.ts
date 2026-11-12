/**
 * Capture V1 transport shared by the PostHog SDKs. `CaptureError`, `CaptureDroppedEvent`,
 * `CaptureErrorParams` and `CaptureEndpoint` are public through posthog-node and follow semver;
 * everything else is internal to PostHog SDKs and can change in any release.
 *
 * @packageDocumentation
 */
export * from './compression'
export * from './errors'
export * from './sender'
export * from './serialize'
export * from './transform'
export * from './types'
export * from './uuid'
