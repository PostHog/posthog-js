---
'posthog-react-native': patch
---

Expo plugin: apply `skipOnConflict` to the native iOS dSYM upload build phase. When both `uploadNativeSymbols` and `skipOnConflict` are enabled, the generated phase now sets `POSTHOG_SKIP_ON_CONFLICT=1` so posthog-ios's `upload-symbols.sh` forwards `--skip-on-conflict` to `posthog-cli dsym upload`, letting builds continue when a dSYM with the same UUID but different content already exists. Re-running prebuild also refreshes the existing dSYM phase script so option changes take effect.
