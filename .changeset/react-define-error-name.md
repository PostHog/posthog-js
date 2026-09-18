---
'@posthog/react': patch
---

Set the React error boundary's component-stack error name with `Object.defineProperty`, so the boundary still reports the original error on pages where a browser extension has made `Error.prototype.name` non-writable.
