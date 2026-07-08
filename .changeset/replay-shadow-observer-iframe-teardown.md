---
'@posthog/rrweb': patch
'posthog-js': patch
---

fix session replay silently dropping shadow DOM mutations after an iframe teardown

The single shared ShadowDomManager observes every shadow root on the page, but MutationBuffer.reset() disconnected it. That reset fires whenever any one buffer is torn down, so an iframe being removed or navigating away disconnected every shadow-root observer page-wide. Shadow DOM content (for example a widget mounted in an open shadow root) then stopped recording until the next periodic full snapshot re-registered it. Buffer teardown now releases only its own resources; global shadow observation is reset by takeFullSnapshot and on recording stop.
