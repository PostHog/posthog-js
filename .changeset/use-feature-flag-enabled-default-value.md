---
"@posthog/react": minor
---

Add an optional `defaultValue` argument to `useFeatureFlagEnabled`. When supplied, the hook returns that value instead of `undefined` while flags are loading or when the flag is absent, and the return type narrows to `boolean`. Omitting the argument keeps the existing `boolean | undefined` behavior.
