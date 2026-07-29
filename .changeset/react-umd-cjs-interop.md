---
'posthog-js': patch
'@posthog/react': patch
---

fix(react): restore CommonJS default import interop in UMD bundles

React hooks used without a `PostHogProvider` now receive the default PostHog instance again when the UMD build is loaded through CommonJS.
