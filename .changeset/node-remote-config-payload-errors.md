---
'posthog-node': minor
---

fix: `getRemoteConfigPayload` no longer returns an error response body as the payload, and no longer throws on an empty body. A response with a status outside 200 to 299 now resolves to `undefined` and emits a `RemoteConfigPayloadError` (with `status` and `flagKey`) on the client's `error` event; a flag with no payload (an empty 200 body) resolves to `undefined`. Callers that read the error body as the payload get `undefined` instead.
