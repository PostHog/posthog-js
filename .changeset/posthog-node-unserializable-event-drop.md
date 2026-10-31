---
'posthog-node': patch
---

An event with a property value that throws when it is serialized, such as a nested getter or a `toJSON` method that throws, is now dropped alone and reported through the `'error'` event as a local drop (`details: 'unserializable event'`). Before, the error went to `console.error` with its message, which can hold event data, or for `captureImmediate()` to `'error'` as a raw error. With no `'error'` listener, the SDK logs one line with the count and reason only.
