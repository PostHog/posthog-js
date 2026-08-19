---
'@posthog/plugin-utils': minor
'@posthog/rollup-plugin': minor
---

Add experimental `sourcemaps.releaseMode: 'event'` to the rollup plugin. In event mode the plugin resolves the release with `posthog-cli release resolve` and injects its id into every chunk, so exceptions report their release directly instead of it being bound to the uploaded symbol sets, and chunk ids are derived from chunk content so a rebuild of unchanged code reuses the symbol set already uploaded. The option defaults to the `POSTHOG_RELEASE_MODE` environment variable and then to `symbol-set`, which behaves exactly as before. Event mode needs a posthog-cli with the `release resolve` command.
