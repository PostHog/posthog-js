---
"posthog-react-native": patch
---

fix(ios): iOS Release builds with Expo config plugin fail when bundle phase uses a /bin/sh prefix, causing posthog-xcode.sh to receive /bin/sh as $1 instead of the react-native-xcode.sh path. The PACKAGER_SOURCEMAP_FILE preservation patch was silently skipped, leading to posthog-cli failing with "Failed to load minified map". Fixes #3682.
