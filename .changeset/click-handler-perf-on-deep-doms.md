---
'posthog-js': patch
---

Fix click-handler latency on pages with deep DOMs or hundreds of sibling rows. The shared ancestor walk no longer calls `window.getComputedStyle` once a "useful" parent has been found, and the dead-click and rage-click checks skip the cursor-pointer lookup entirely since they don't read that signal. The `nth_child` / `nth_of_type` sibling walk is also capped to a fixed depth so a virtualised list with hundreds of siblings no longer multiplies into seconds of synchronous work per click.
