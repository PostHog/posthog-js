---
'posthog-js': patch
---

Session replay: fixed a stale element left rendered in the player when a mutation re-added a node id with changed attributes. Affects both `useVirtualDom` modes.
