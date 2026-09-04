---
"@posthog/react-native-plugin": patch
---

Skip the explicit Kotlin plugin when AGP provides built-in Kotlin

Android Gradle Plugin 9 registers the `kotlin` extension itself, so applying
`kotlin-android` on top of it fails configuration with "Cannot add extension with
name 'kotlin'". The plugin is now applied only when nothing has registered that
extension yet, which keeps AGP 8 working unchanged and covers AGP 10, where the
`android.builtInKotlin` opt-out is removed.
