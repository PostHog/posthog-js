import ExpoModulesCore

public class NativeCrashModule: Module {
    public func definition() -> ModuleDefinition {
        Name("NativeCrash")

        // `fatalError` is a Swift trap — it cannot be caught by Expo's call
        // handler, so the process terminates and posthog-ios' crash reporter
        // captures it (delivered on next launch).
        Function("crashNative") {
            CrashOuterLayer.process()
        }
    }
}

// Nested layers so the captured native stack trace has meaningful frames.
private enum CrashOuterLayer {
    static func process() {
        CrashMiddleLayer.handle()
    }
}

private enum CrashMiddleLayer {
    static func handle() {
        CrashInnerLayer.execute()
    }
}

private enum CrashInnerLayer {
    static func execute() {
        fatalError("PostHog native iOS test crash")
    }
}
