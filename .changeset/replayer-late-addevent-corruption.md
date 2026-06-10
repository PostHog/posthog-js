---
'@posthog/rrweb': patch
'posthog-js': patch
---

replayer: stop corrupting recordings when events are added behind the playhead. `addEvent()` used to apply any event older than the playback baseline synchronously onto the current DOM — correct for live-mode catch-up, but wrong for on-demand playback where snapshot chunks can finish loading after the user has seeked ahead. Applying those past mutations onto a DOM at a different position made their `removes` fail mirror lookups, and `applyMutation` then deleted the failed entries from the event objects themselves, so every later seek rebuilt from corrupted data (DOM nodes accumulating, e.g. duplicated text) and exports serialized the stripped events. Past events are now only applied synchronously in live mode (otherwise they are just inserted for the next seek to pick up), and `applyMutation` filters removes into a local copy instead of mutating the event data.
