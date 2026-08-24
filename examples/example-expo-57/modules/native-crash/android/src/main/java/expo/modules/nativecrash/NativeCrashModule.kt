package expo.modules.nativecrash

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NativeCrashModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NativeCrash")

        Function("crashNative") {
            // Re-throw on the main looper so the exception escapes Expo's call
            // handler (which would otherwise convert it into a JS error) and
            // reaches the JVM's uncaught-exception handler that posthog-android
            // hooks for native crash capture.
            Handler(Looper.getMainLooper()).post {
                crashOuterLayer()
            }
        }
    }
}

// Nested calls so the captured native stack trace has meaningful frames.
private fun crashOuterLayer() {
    crashMiddleLayer()
}

private fun crashMiddleLayer() {
    crashInnerLayer()
}

private fun crashInnerLayer() {
    throw RuntimeException("PostHog native Android test crash")
}
