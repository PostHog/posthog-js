/**
 * Capture V1 transport shared by the PostHog SDKs. It follows semver, because the SDKs depend on
 * core with a caret range. `CaptureError`, `CaptureDroppedEvent`, `CaptureErrorParams` and
 * `CaptureEndpoint` are also public through posthog-node.
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
