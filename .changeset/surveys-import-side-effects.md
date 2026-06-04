---
"posthog-react-native": patch
---

Fix `posthog-react-native` throwing `Cannot read properties of undefined (reading 'create')` at import time in analytics-only setups and Jest `testEnvironment: node` runs without the React Native preset. The surveys UI is reachable from the package entrypoint and no longer evaluates native `StyleSheet` APIs while loading. (#3740)
