---
'posthog-js': patch
---

fix(replay): never record or flush snapshots while the sampling decision is missing

When the stored sampling decision was wiped while the recorder was running (e.g. by `posthog.reset()`), the undecided session reported an `active` status and could leak short junk recordings from sessions that then decided not to record. Sampling decisions are now persisted tagged with the session id they were made for (`'!' + sessionId` when sampled out), are re-made on every session id change regardless of config availability, and a buffer is never flushed without a decision when sampling is configured. Because the decision is a deterministic hash of the session id, re-deciding never flips the outcome for the same session. This also stops a stale `false` decision from a previous session being inherited by a new session, which chronically under-recorded returning visitors.
