---
'posthog-node': patch
---

An event whose `before_send` hook leaves `distinctId` missing, `null` or not a string is now dropped before sending and reported through the `'error'` event as a local drop (`details: 'invalid event'`). Before, the SDK sent the value as text, or sent `""` when the hook removed it. A caller's non-string `distinctId` is now turned into a string before `before_send` runs, so a hook that leaves it alone still sends it. A hook that sets `distinctId` to `""` still sends it, and capture drops that event and reports it.
