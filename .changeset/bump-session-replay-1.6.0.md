---
'posthog-react-native': minor
---

Bump optional peer dependency `posthog-react-native-session-replay` floor to `>= 1.6.0`. The new minor adds an opt-in path that resolves `posthog-ios` through Swift Package Manager when consumers set `"posthog.useSpm": "true"` in their app's `ios/Podfile.properties.json` (with `use_frameworks! :linkage => :dynamic`). Default behavior is unchanged: without the property, `posthog-ios` continues to resolve through CocoaPods. See the [session-replay README](https://github.com/PostHog/posthog-react-native-session-replay#ios-dependency-resolution) for the opt-in details.
