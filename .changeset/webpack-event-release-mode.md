---
'@posthog/webpack-plugin': minor
'@posthog/nextjs-config': minor
---

Add experimental `sourcemaps.releaseMode: 'event'` to the webpack plugin and Next.js config. In event mode posthog-cli resolves the release once and injects its id into every chunk on disk, so exceptions report their release directly instead of it being bound to the uploaded symbol sets, and chunk ids are content-derived so a rebuild of unchanged code reuses the symbol set already uploaded. On webpack >= 5.104 the plugin also turns on webpack's own debug ids, which the CLI adopts as chunk ids, so one id identifies a chunk across the whole toolchain. The option defaults to the `POSTHOG_RELEASE_MODE` environment variable and then to `symbol-set`, which behaves exactly as before. Event mode needs a posthog-cli with the `release resolve` command.
