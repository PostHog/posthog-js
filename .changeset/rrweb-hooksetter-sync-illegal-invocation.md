---
'@posthog/rrweb': patch
'@posthog/rrweb-snapshot': patch
'@posthog/rrweb-record': patch
'posthog-js': patch
---

Session recording no longer emits an uncaught `TypeError: Illegal invocation` from the input observer's *synchronous* native-setter call. The previous fix only guarded the deferred hooked setter; the synchronous `original.set.call(this, value)` still ran with a non-native `this` (a proxy, custom element, or cross-realm object) and threw inside the host page's own assignment. The recorder now forwards to the native setter only when `this` genuinely derives from the element prototype, and the accessor reads in the input event handler and `getInputType` are likewise skipped for a non-native `this`. Genuine elements (including file inputs that legitimately throw) keep their native behavior.
