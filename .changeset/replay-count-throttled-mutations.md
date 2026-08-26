---
'posthog-js': minor
---

Session recordings now report `$sdk_debug_replay_throttled_mutations_dropped`, a per-session count of attribute mutations the replay mutation throttler discarded. A discarded `class` or `style` change never reaches the player, so the count measures how often a recording's DOM can drift from the live page.
