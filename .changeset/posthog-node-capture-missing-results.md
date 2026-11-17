---
'posthog-node': patch
---

A 2xx capture response whose JSON body has no `results` field now fails the whole batch and reports it through the `'error'` event, like a body that is not JSON or has a `results` value that is not an object. The batch is not resent. A response with an empty `results` object still means every event was delivered.
