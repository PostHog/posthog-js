---
'posthog-node': minor
---

feat: `getRemoteConfigPayload` resolves `undefined` instead of returning an error response body or throwing on an empty body, and emits a new `RemoteConfigPayloadError` with the `statusCode` and `flagKey` on the client's `error` event for a failed response.
