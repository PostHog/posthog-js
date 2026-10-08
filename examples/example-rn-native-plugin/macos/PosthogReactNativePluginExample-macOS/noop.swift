// Intentionally empty. Its presence makes this otherwise-Objective-C app target
// a mixed Swift/ObjC target, so Xcode links the Swift runtime and the static-library
// compatibility libs (swiftCompatibility56 / swiftCompatibilityConcurrency) that the
// Swift-based posthog-react-native-plugin pod references. Without a Swift file in the
// app target, the macOS link fails with undefined __swift_FORCE_LOAD_$ symbols.
import Foundation
