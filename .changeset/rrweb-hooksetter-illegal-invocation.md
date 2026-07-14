---
'@posthog/rrweb': patch
'@posthog/rrweb-record': patch
'posthog-js': patch
---

Fix a recurring `TypeError: Illegal invocation` thrown from the rrweb input observer. When recording, `hookSetter` redefines the native `value`/`checked`/`selectedIndex`/`selected` setters on the input-element prototypes and, on every assignment, invokes the native setter (and a mock event handler that reads native accessors) with the assigning object as `this`. When `this` is not a genuine native element — a custom element, a cross-realm object, or a proxy another library placed on the prototype chain — the native accessor rejects the call with 'Illegal invocation'. The synchronous native-setter call was unwrapped, so it propagated into the host page's assignment path and polluted error tracking with churning fingerprints. Both native-setter invocations in `hookSetter` are now guarded so an illegal `this` is silently ignored rather than thrown; recording degrades gracefully instead of throwing.
