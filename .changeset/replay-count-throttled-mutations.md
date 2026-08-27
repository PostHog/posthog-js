---
'posthog-js': minor
---

Report `$sdk_debug_replay_throttled_mutations_dropped` on captured events, counting the attribute changes the session recorder discarded during that session. The recorder throttles elements that change hundreds of times a second, and a discarded `class` or `style` change never reaches the player — so a recording can keep showing an element the live page had already hidden. Query this property to see whether your app is affected.
