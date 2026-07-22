---
'@posthog/rrweb': patch
'@posthog/rrweb-snapshot': patch
'@posthog/rrweb-record': patch
'posthog-js': patch
---

Session recording no longer emits an uncaught `TypeError: Illegal invocation` from the input observer's *synchronous* native-setter call. The previous fix only guarded the deferred hooked setter; the synchronous `original.set.call(this, value)` still ran with a non-native `this` (a proxy, custom element, or cross-realm object) and threw inside the host page's own assignment. The recorder now probes the native getter — which fails the same internal-slot brand check as the setter — before forwarding: a non-native `this` is skipped, so the recorder no longer re-throws from its own frame, while genuine elements (including file inputs that legitimately throw on a programmatic value) keep their native behavior. The input event handler and `getInputType` are similarly guarded against reading native accessors on a non-native `this`.
