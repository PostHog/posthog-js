---
'posthog-js': patch
---

fix(dead-clicks): don't flag wake-up clicks as dead, and never let a visibility change mark a click dead

The dead-click detector treated a `visibilitychange` as evidence a click was dead: it measured `Math.abs(clickTimestamp - lastVisibilityChange)` and, once that exceeded the threshold, timed the click out as dead. Because `_lastVisibilityChange` only records the tab becoming visible, any click in a session where the tab had ever been backgrounded (median gap ~1 minute) was flagged. The visibility signal now only ever *suppresses*: a click within a wake-up window (1s, wide enough for a real "tab back, then click the page" gesture) of the tab regaining visibility is treated as the click that woke/focused the tab and is not flagged, while a visibility change never causes a dead click. `$dead_click_visibility_changed_timeout` is retained in the payload (always false) so the event shape is unchanged.
