---
'posthog-js': patch
---

fix(replay): ship `ph-no-capture` absolute-position fix from #3678 to `posthog-js`. The original changeset only bumped `@posthog/rrweb` and `@posthog/rrweb-snapshot`; because `posthog-js` depends on `@posthog/rrweb` via `workspace:*`, the cascade did not bump `posthog-js`, so the rebuilt bundle containing the fix was not published. This changeset re-publishes `posthog-js` with the fix.
