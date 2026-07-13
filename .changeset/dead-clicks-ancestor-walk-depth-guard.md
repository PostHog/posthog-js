---
'posthog-js': patch
---

Bound autocapture's DOM ancestor walks against abnormal host-page DOM trees. `autocapturePropertiesForElement` and `shouldCaptureElement` now stop climbing the `parentNode` chain after 1000 ancestors or if they revisit a node (only possible when a page patches `parentNode`, since native DOMs cannot contain cycles), instead of walking indefinitely. When `shouldCaptureElement` cannot finish checking ancestors for `ph-no-capture`/`ph-sensitive`, it fails closed and reports the element as not capturable. Behavior on normal DOM trees is unchanged.
