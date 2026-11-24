/**
 * Capture V1 transport shared by the PostHog SDKs. It follows semver, because the SDKs depend on
 * core with a caret range. `CaptureError`, `CaptureDroppedEvent`, `CaptureErrorParams` and
 * `CaptureEndpoint` are also public through posthog-node.
 *
 * @packageDocumentation
 */
export {
  CAPTURE_COMPRESSIONS,
  resolveCaptureCodec,
  webCompressor,
  type CaptureCodec,
  type CaptureCompression,
  type CaptureCompressor,
} from './compression'
export {
  CaptureError,
  CaptureLossTally,
  describeCaptureLoss,
  type CaptureDroppedEvent,
  type CaptureErrorParams,
} from './errors'
export {
  V1CaptureSender,
  type V1CaptureSenderConfig,
  type V1CaptureSenderHooks,
  type V1RequestIdentity,
  type V1SendDeferral,
  type V1SendOptions,
} from './sender'
export { serializeV1Event, utf8Length, wireProblem, type SerializedV1Event } from './serialize'
export { readEventOptions } from './transform'
export { AI_CAPTURE_ENDPOINT, ANALYTICS_CAPTURE_ENDPOINT, type CaptureEndpoint, type V1EventOptions } from './types'
export { canonicalizeUuid, eventUuidv7 } from './uuid'
