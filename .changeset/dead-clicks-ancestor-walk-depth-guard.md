---
'posthog-js': patch
---

Guard autocapture's ancestor-walk loops against pathologically deep or cyclic DOM trees. `autocapturePropertiesForElement` and `shouldCaptureElement` now cap how far they climb the `parentNode` chain and bail out if they revisit a node, so autocapture (including dead-clicks autocapture) degrades gracefully instead of exhausting the JS call stack on abnormal host-page DOMs. Normal capture behavior is unchanged.
