---
'posthog-js': patch
---

Make `jsonStringify` circular-safe so event serialization never throws. Previously a captured property holding a circular value — most commonly a DOM node that retains a React fiber pointing back at the element — made `JSON.stringify` throw `Converting circular structure to JSON`; with `capture_exceptions` enabled that throw was recaptured as a new `$exception`, at times in a loop. On a throw we now fall back to `safeJsonStringify` from `@posthog/core`. The fast (non-circular) path is unchanged, and only true cycles become `"[Circular]"`, so shared-but-acyclic references keep their real values.
