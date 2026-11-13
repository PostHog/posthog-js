---
'posthog-node': patch
---

An event with a property value that throws when the SDK reads or serializes it, such as a getter or a `toJSON` method that throws, is now dropped alone and reported through the `'error'` event as a local drop (`details: 'unserializable event'`). This covers the call's properties, the copy made for `before_send`, and serialization, on the analytics and AI lanes. In 5.x, a value that threw while the client read the call's properties printed the raw error with `console.error`, and one that threw during serialization failed the whole batch and emitted the raw error on `'error'`. With no `'error'` listener, the SDK logs one line with the count and reason only.
