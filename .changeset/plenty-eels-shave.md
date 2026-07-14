---
'posthog-react-native': patch
---

Expo plugin: apply `skipOnConflict` to the native iOS dSYM upload build phase. When both `uploadNativeSymbols` and `skipOnConflict` are enabled, the generated phase sets `POSTHOG_SKIP_ON_CONFLICT=1`; posthog-ios versions whose `upload-symbols.sh` supports the variable forward it as `--skip-on-conflict` to `posthog-cli dsym upload` (requires posthog-cli >= 0.7.12), letting builds continue when a dSYM with the same UUID but different content already exists. Older posthog-ios versions ignore the variable and keep the current fail-on-conflict behavior. Re-running prebuild refreshes the dSYM phase while its script is still plugin-generated, so `includeSource`/`skipOnConflict` changes take effect without a clean prebuild; user-customized phase scripts are left untouched.
