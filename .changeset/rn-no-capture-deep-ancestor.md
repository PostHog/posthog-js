---
'posthog-react-native': patch
---

Respect `ph-no-capture` on any ancestor of a touched or clicked element. Previously an interaction deep inside an opted-out subtree could still send an `$autocapture` event carrying that subtree's element text and props, so apps relying on a high-level `ph-no-capture` may see fewer `$autocapture` events after upgrading. Interactions more than 1000 elements deep in the view hierarchy now produce no `$autocapture` event rather than a truncated one.
