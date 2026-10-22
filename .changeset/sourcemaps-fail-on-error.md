---
'@posthog/webpack-plugin': minor
'@posthog/nextjs-config': minor
---

Add `sourcemaps.failOnError` to fail the build when PostHog cannot process or upload source maps, for example because the personal API key is invalid. It defaults to `false`, which keeps logging the error and passing the build.
