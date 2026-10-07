---
'posthog-js': patch
---

Fix session replays dropping elements that a page moves into a new wrapper in the same change that moves the wrapper's parent, which left plain-JS Ionic modals empty.
