---
'posthog-js': patch
---

fix(replay): keep recording through a session-id rotation when the persisted remote config is past its TTL. A rotation restart transits through stop() before start(), which made the config TTL check treat it as a cold boot: the stale config was discarded, start() bailed silently, and the recorder died with session attribution stuck on the old session id. The rotated session then shipped events with no initial full snapshot, producing recordings whose prefix cannot be played until something else restarted recording. Affects any rotation on a session older than one hour, most visibly posthog.reset() on logout. Cold-boot TTL behavior is unchanged.
