---
'posthog-js': patch
---

fix(dead-clicks): survive a denied property access in Firefox

Firefox denies property access on a DOM node from another origin or from a realm that was torn down. The detector reads `isConnected` and `nodeType` on mutation records and on composed paths, and reads `getRootNode` on selection endpoints, so the denial escaped the MutationObserver callback and stopped the rest of the batch from refreshing the liveness timestamp. A node that cannot be read is now treated as a node that cannot be inspected.
