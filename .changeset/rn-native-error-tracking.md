---
'posthog-react-native': minor
---

Add opt-in native iOS and Android crash capture through the optional native plugin:

- Runtime: `errorTracking.autocapture.nativeCrashes` enables native crash autocapture.
- Build tooling: the Expo config plugin option `uploadNativeSymbols` wires native debug-symbol upload so crashes are symbolicated — iOS dSYMs via posthog-ios's `upload-symbols.sh`, and Android ProGuard/R8 mappings via the `com.posthog.android` Gradle plugin. Pass `uploadNativeSymbols: { includeSource: true }` to also upload native source for crash context (iOS only).
