---
'@posthog/rollup-plugin': minor
'@posthog/plugin-utils': minor
---

Add experimental `sourcemaps.noReleaseBind` option (defaults to the `POSTHOG_NO_RELEASE_BIND` env var). When enabled, the plugin emits ECMA-426 debug ids (rollup >= 4.28) and passes `--no-release-bind` to posthog-cli, which adopts them as chunk ids - stable across rebuilds. Requires a posthog-cli that understands the flag.
