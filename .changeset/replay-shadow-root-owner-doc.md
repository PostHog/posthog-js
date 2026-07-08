---
'@posthog/rrweb': patch
'posthog-js': patch
---

fix session replay leaking a shadow-root observer when a same-origin iframe is removed

Follow-up to the shadow-observer iframe-teardown fix: `takeFullSnapshot`'s `onSerialize` registers every shadow root with the top-level document, so a root nested in a same-origin iframe was keyed to the wrong document and its observer/buffer were not disconnected when that iframe was removed (they lingered until the next full snapshot). `addShadowRoot` now derives the owning document from the host element, so per-document teardown matches iframe-nested roots too.
