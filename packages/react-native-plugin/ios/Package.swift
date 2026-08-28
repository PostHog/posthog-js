// swift-tools-version: 6.0

import PackageDescription

// React Native's SwiftPM autolinker references this package through
// build/generated/autolinking/libs/ReactNativePlugin. These paths are relative
// to that stable alias, not to node_modules.
let reactNativeDependencies: [Package.Dependency] = [
    .package(name: "ReactNative", path: "../../../../xcframeworks"),
    .package(name: "React-GeneratedCode", path: "../../../ios"),
]

let reactHeaderDependencies: [Target.Dependency] = [
    .product(name: "ReactHeaders", package: "ReactNative"),
    .product(name: "ReactNativeHeaders", package: "ReactNative"),
    .product(name: "ReactNativeDependenciesHeaders", package: "ReactNative"),
    .product(name: "ReactAppHeaders", package: "React-GeneratedCode"),
]

let package = Package(
    // This name must match React Native's Swift-name derivation for
    // @posthog/react-native-plugin.
    name: "ReactNativePlugin",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "ReactNativePlugin",
            targets: ["PosthogReactNativePlugin", "PosthogReactNativePluginBridge"]
        ),
    ],
    dependencies: reactNativeDependencies + [
        .package(
            url: "https://github.com/PostHog/posthog-ios.git",
            .upToNextMinor(from: "3.70.1")
        ),
    ],
    targets: [
        .target(
            name: "PosthogReactNativePlugin",
            dependencies: reactHeaderDependencies + [
                .product(name: "PostHog", package: "posthog-ios"),
            ],
            path: ".",
            exclude: [
                "Package.swift",
                "PosthogReactNativePlugin-Bridging-Header.h",
                "PosthogReactNativePlugin.mm",
            ],
            sources: ["PosthogReactNativePlugin.swift"]
        ),
        // SwiftPM cannot compile Swift and Objective-C++ in one target. The
        // RCT_EXTERN_MODULE registration bridge is independent and is linked
        // into the same library product as the Swift implementation.
        .target(
            name: "PosthogReactNativePluginBridge",
            dependencies: reactHeaderDependencies,
            path: ".",
            exclude: [
                "Package.swift",
                "PosthogReactNativePlugin.swift",
            ],
            sources: ["PosthogReactNativePlugin.mm"],
            publicHeadersPath: "."
        ),
    ],
    // Match the CocoaPods integration's Swift 5 language mode. The plugin has
    // main-thread-confined Objective-C bridge state that is not yet annotated
    // for Swift 6's strict concurrency checks.
    swiftLanguageModes: [.v5]
)
