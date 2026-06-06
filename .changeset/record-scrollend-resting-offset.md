---
'posthog-js': patch
'@posthog/rrweb': patch
---

record: capture the resting scroll offset on `scrollend`. A scroll applied before its target is scrollable (e.g. scroll-snap-revealed sheets/modals whose content mounts the same frame, like Silk sheets) clamps to 0, so the throttled `scroll` samples miss the final snapped position and the element is recorded as scrolled to 0 — leaving the revealed content out of view on replay regardless of seeking. We now also listen for `scrollend` (where supported) and emit the settled offset, so the true resting position lands in the recording. Scroll positions are deduped per node so `scroll` and `scrollend` never record the same offset twice, regardless of which fires last. `posthog-js` is bumped too so the rebuilt bundle containing the fix is published.
