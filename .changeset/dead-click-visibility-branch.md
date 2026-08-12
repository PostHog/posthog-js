---
'posthog-js': patch
'@posthog/types': patch
---

fix(dead-clicks): treat visibility and focus changes as liveness signals, not dead-click evidence

The dead-click detector treated a `visibilitychange` as evidence a click was dead: it measured `Math.abs(clickTimestamp - lastVisibilityChange)` and, once that exceeded the threshold, timed the click out as dead. Because it only recorded the tab becoming visible, any click in a session where the tab had ever been backgrounded (median gap ~1 minute) was flagged.

A visibility or focus change near a click is the opposite — a sign the click did something (it woke/focused the tab, opened a new tab, or opened a new window/popup) — so these signals now only ever *suppress* a dead click, never cause one:

- Visibility changes are recorded in both directions (a click that opens a new tab sends the current tab to `hidden`), and a window `focus`/`blur` observer is added, since a click that opens a new window/popup may leave the tab visible and only surface as the current window losing focus.
- A click within a wake-up/interaction window (1s, wide enough for a real "tab back, then click" gesture) of any such change is suppressed.
- The visibility signal no longer feeds the dead-marking path at all. `$dead_click_visibility_changed_timeout` stays in the payload (always false) for shape compatibility, and a new `$dead_click_focus_changed_delay_ms` is emitted for observability.
