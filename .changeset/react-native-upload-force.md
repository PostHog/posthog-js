---
'posthog-react-native': minor
---

feat: add a `force` option for symbol uploads

The Hermes source map upload could keep a symbol set that already exists with different content (`skipOnConflict`), but never overwrite it. `force` adds the other half: it passes `--force` to `posthog-cli` on both platforms, from the `force` Expo plugin prop, the `POSTHOG_FORCE` environment variable or the `--posthog-force` argument on iOS, and the `posthogReactNativeForce` gradle ext property on Android. With `uploadNativeSymbols` enabled it also reaches the iOS dSYM upload phase. The two options are mutually exclusive, because `posthog-cli` rejects `--skip-on-conflict` together with `--force`.
