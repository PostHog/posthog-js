---
'posthog-js': patch
---

Fix a Chrome renderer crash (grey "Aw, Snap" tab, "Error code: 5") that could still occur when closing an in-app survey on a heavy page such as a large dashboard.

Closing a survey animated the fade-out with `document.startViewTransition`, which snapshots the entire page viewport. The survey applied no `view-transition-name` scoping, so on a heavy host page capturing that whole-page snapshot could exhaust renderer memory and crash the tab. A previous fix addressed a related crash (a snapshot pointing at a removed node) but left the document-level transition — and its whole-page snapshot cost — in place.

The survey renders in an isolated shadow root, so it never needed a document-level transition. The close now fades the popup out with a plain CSS opacity transition scoped to the survey's own container, then unmounts it once the fade has run. No whole-page snapshot, no crash, same fade-out UX.
