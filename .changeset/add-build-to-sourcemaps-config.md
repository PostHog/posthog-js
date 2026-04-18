---
'@posthog/plugin-utils': minor
'@posthog/nuxt': minor
---

Add `build` to sourcemaps config, forwarded to posthog-cli as `--build`. Lets consumers of the bundler plugins (webpack, rollup, nextjs-config, nuxt) attach a build number as release metadata. Requires posthog-cli >= 0.7.8.
