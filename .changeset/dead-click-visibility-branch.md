---
'posthog-js': patch
---

fix(dead-clicks): stop stale visibility changes from flagging clicks as dead

The dead-click detector measured the visibility-change delay as `Math.abs(clickTimestamp - lastVisibilityChange)`, so a `visibilitychange` from _before_ a click (e.g. the tab having been backgrounded earlier in the session) was read as a multi-second "response" and pushed the click over the visibility timeout. It now matches the mutation and selection branches and only counts a visibility change that happens after the click, removing a large class of false-positive `$dead_click` events.
