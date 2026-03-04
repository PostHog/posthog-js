---
'posthog-js': patch
---

fix(replay): fall back to persisted config when remote config fetch fails

When the remote config fetch failed (network error, ad blocker, CDN outage), the SDK received an empty `{}` response with no `sessionRecording` key. The `onRemoteConfig` handler returned early without ever setting `_receivedFlags = true`, leaving the recording permanently stuck in `pending_config` status for the entire page session.

This removes the `_receivedFlags` gate entirely. The 1-hour TTL on persisted config (added in #3051, increased from 5 minutes) and the stale-config retry in `_onScriptLoaded` (added in #3093) already prevent recording from starting with outdated config. The additional gate was redundant and created a deadlock when the config fetch failed.

Now when the config fetch fails, `startIfEnabledOrStop()` is called and falls back to persisted config from a previous page load. If no persisted config exists (first-ever visit), recording is correctly disabled rather than silently stuck.
