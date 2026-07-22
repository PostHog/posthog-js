import PostHog

/// Meant for internally logging PostHog related things
private func hedgeLog(_ message: String) {
    print("[PostHog] \(message)")
}

#if !os(iOS)
    // Session replay is part of posthog-ios's iOS-only surface, so recording is a no-op on macOS.
    // Log once so a caller isn't left wondering why recording "started" but nothing arrives.
    private var didLogSessionReplayUnsupported = false
    private func logSessionReplayUnsupportedOnMacOS() {
        guard !didLogSessionReplayUnsupported else { return }
        didLogSessionReplayUnsupported = true
        hedgeLog("Session replay is not supported on macOS")
    }
#endif

/// Deduplication works on Android (both architectures), iOS (old architecture only), and macOS.
/// On the iOS new architecture, fatal JS exception events surface as a generic SIGABRT
/// crash event with no JS-error text in any field, so they currently cannot be filtered.
private let fatalJsErrorMarkers = ["Unhandled JS Exception", "ExceptionsManager.reportException", "facebook::jsi::JSError"]

private func containsFatalJsErrorMarker(_ text: String?) -> Bool {
    guard let text else { return false }
    return fatalJsErrorMarkers.contains { text.contains($0) }
}

private func isReactNativeFatalJsError(_ event: PostHogEvent) -> Bool {
    guard event.event == "$exception",
          let exceptionList = event.properties["$exception_list"] as? [[String: Any]]
    else { return false }
    return exceptionList.contains { exception in
        if containsFatalJsErrorMarker(exception["type"] as? String) {
            return true
        }
        if containsFatalJsErrorMarker(exception["value"] as? String) {
            return true
        }
        // New-architecture RN rethrows fatal JS errors as a C++ jsi::JSError (SIGABRT);
        // the JS-error text only survives in the signal's crash-info message.
        let mechanism = exception["mechanism"] as? [String: Any]
        let meta = mechanism?["meta"] as? [String: Any]
        let signal = meta?["signal"] as? [String: Any]
        return containsFatalJsErrorMarker(signal?["crash_info_message"] as? String)
    }
}

@objc(PosthogReactNativePlugin)
class PosthogReactNativePlugin: NSObject {
    private var config: PostHogConfig?

    @objc(setup:withSdkOptions:withPluginConfig:withResolver:withRejecter:)
    func setup(
        sessionId: String, sdkOptions: [String: Any], pluginConfig: [String: Any],
        resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock
    ) {
        let sessionReplayConfig = pluginConfig["sessionReplay"] as? [String: Any] ?? [:]
        let errorTrackingConfig = pluginConfig["errorTracking"] as? [String: Any] ?? [:]
        let exceptionStepsConfig = errorTrackingConfig["exceptionSteps"] as? [String: Any] ?? [:]

        setupNativeSdk(
            method: "setup",
            sessionId: sessionId,
            sdkOptions: sdkOptions,
            sessionReplayEnabled: sessionReplayConfig["enabled"] as? Bool ?? false,
            sdkReplayConfig: sessionReplayConfig["sdkReplayConfig"] as? [String: Any] ?? [:],
            decideReplayConfig: sessionReplayConfig["decideReplayConfig"] as? [String: Any] ?? [:],
            nativeErrorTrackingAutocapture: errorTrackingConfig["nativeAutocapture"] as? Bool ?? false,
            exceptionStepsConfig: exceptionStepsConfig,
            resolve: resolve
        )
    }

    @objc(start:withSdkOptions:withSdkReplayConfig:withDecideReplayConfig:withResolver:withRejecter:)
    func start(
        sessionId: String, sdkOptions: [String: Any], sdkReplayConfig: [String: Any],
        decideReplayConfig: [String: Any], resolve: RCTPromiseResolveBlock,
        reject _: RCTPromiseRejectBlock
    ) {
        setupNativeSdk(
            method: "start",
            sessionId: sessionId,
            sdkOptions: sdkOptions,
            sessionReplayEnabled: true,
            sdkReplayConfig: sdkReplayConfig,
            decideReplayConfig: decideReplayConfig,
            nativeErrorTrackingAutocapture: false,
            exceptionStepsConfig: [:],
            resolve: resolve
        )
    }

    private func setupNativeSdk(
        method _: String,
        sessionId: String,
        sdkOptions: [String: Any],
        sessionReplayEnabled: Bool,
        sdkReplayConfig: [String: Any],
        decideReplayConfig: [String: Any],
        nativeErrorTrackingAutocapture: Bool,
        exceptionStepsConfig: [String: Any],
        resolve: RCTPromiseResolveBlock
    ) {
        if sessionId.isEmpty {
            hedgeLog("Invalid empty sessionId provided.")
            resolve(nil)
            return
        }

        let projectToken =
            (sdkOptions["projectToken"] as? String)
                ?? (sdkOptions["apiKey"] as? String)
                ?? ""
        let host = sdkOptions["host"] as? String ?? PostHogConfig.defaultHost
        let debug = sdkOptions["debug"] as? Bool ?? false

        PostHogSessionManager.shared.setSessionId(sessionId)

        let config = PostHogConfig(projectToken: projectToken, host: host)
        config.captureApplicationLifecycleEvents = false
        config.captureScreenViews = false
        config.debug = debug
        config.errorTrackingConfig.autoCapture = nativeErrorTrackingAutocapture

        // Keep the native exception-steps buffer aligned with the JS layer (one logical buffer).
        if let enabled = exceptionStepsConfig["enabled"] as? Bool {
            config.errorTrackingConfig.exceptionSteps.enabled = enabled
        }
        if let maxBytes = exceptionStepsConfig["maxBytes"] as? Int {
            config.errorTrackingConfig.exceptionSteps.maxBytes = maxBytes
        }

        // React Native rethrows fatal JS errors natively (RCTFatalException / ExceptionsManager).
        // The JS layer already captured them, so drop the native duplicate.
        config.setBeforeSend { event in
            isReactNativeFatalJsError(event) ? nil : event
        }

        // Surveys and session replay are iOS-only in posthog-ios, so the APIs below
        // don't exist on macOS. macOS gets error tracking only.
        #if os(iOS)
            if #available(iOS 15.0, *) {
                config.surveys = false
            }

            // Always apply the session replay configuration so that recording started later
            // (e.g. startRecording or a linked feature flag) uses the right mode and masking;
            // sessionReplayEnabled only controls whether recording starts at setup.
            config.sessionReplay = sessionReplayEnabled
            config.sessionReplayConfig.screenshotMode = true

            let maskAllTextInputs = sdkReplayConfig["maskAllTextInputs"] as? Bool ?? true
            config.sessionReplayConfig.maskAllTextInputs = maskAllTextInputs

            let maskAllImages = sdkReplayConfig["maskAllImages"] as? Bool ?? true
            config.sessionReplayConfig.maskAllImages = maskAllImages

            let maskAllSandboxedViews = sdkReplayConfig["maskAllSandboxedViews"] as? Bool ?? true
            config.sessionReplayConfig.maskAllSandboxedViews = maskAllSandboxedViews

            // read throttleDelayMs and use iOSdebouncerDelayMs as a fallback for back compatibility
            let throttleDelayMs =
                (sdkReplayConfig["throttleDelayMs"] as? Int)
                    ?? (sdkReplayConfig["iOSdebouncerDelayMs"] as? Int)
                    ?? 1000

            let timeInterval: TimeInterval = Double(throttleDelayMs) / 1000.0
            config.sessionReplayConfig.throttleDelay = timeInterval

            let captureNetworkTelemetry = sdkReplayConfig["captureNetworkTelemetry"] as? Bool ?? true
            config.sessionReplayConfig.captureNetworkTelemetry = captureNetworkTelemetry

            let captureLog = sdkReplayConfig["captureLog"] as? Bool ?? true
            config.sessionReplayConfig.captureLogs = captureLog

            config.sessionReplayConfig.sampleRate = sdkReplayConfig["sampleRate"] as? NSNumber

            let screenshotModeBackgroundCapture = sdkReplayConfig["screenshotModeBackgroundCapture"] as? Bool ?? false
            config.sessionReplayConfig.screenshotModeBackgroundCapture = screenshotModeBackgroundCapture

            let endpoint = decideReplayConfig["endpoint"] as? String ?? ""
            if !endpoint.isEmpty {
                config.snapshotEndpoint = endpoint
            }
        #endif

        let distinctId = sdkOptions["distinctId"] as? String ?? ""
        let anonymousId = sdkOptions["anonymousId"] as? String ?? ""

        let sdkVersion = sdkOptions["sdkVersion"] as? String ?? ""

        let flushAt = sdkOptions["flushAt"] as? Int ?? 20
        config.flushAt = flushAt

        // Forward custom headers (e.g. Authorization for a reverse proxy) so the native SDK
        // attaches them to the requests it sends directly (session replay, crash uploads).
        // Keep only string values so a stray non-string doesn't drop every header (matches Android).
        if let rawHeaders = sdkOptions["requestHeaders"] as? [String: Any] {
            config.requestHeaders = rawHeaders.compactMapValues { $0 as? String }
        }

        if !sdkVersion.isEmpty {
            postHogSdkName = "posthog-react-native"
            postHogVersion = sdkVersion
        }

        PostHogSDK.shared.setup(config)

        self.config = config

        guard let storageManager = self.config?.storageManager else {
            hedgeLog("Storage manager is not available in the config.")
            resolve(nil)
            return
        }

        setIdentify(storageManager, distinctId: distinctId, anonymousId: anonymousId)

        resolve(nil)
    }

    @objc(startSession:withResolver:withRejecter:)
    func startSession(
        sessionId: String, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock
    ) {
        if sessionId.isEmpty {
            hedgeLog("Invalid empty sessionId provided.")
            resolve(nil)
            return
        }
        PostHogSessionManager.shared.setSessionId(sessionId)
        PostHogSDK.shared.startSession()
        resolve(nil)
    }

    @objc(isEnabled:withRejecter:)
    func isEnabled(resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        #if os(iOS)
            resolve(PostHogSDK.shared.isSessionReplayActive())
        #else
            // Session replay is unsupported on macOS.
            resolve(false)
        #endif
    }

    @objc(endSession:withRejecter:)
    func endSession(resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        PostHogSDK.shared.endSession()
        resolve(nil)
    }

    @objc(identify:withAnonymousId:withResolver:withRejecter:)
    func identify(
        distinctId: String, anonymousId: String, resolve: RCTPromiseResolveBlock,
        reject _: RCTPromiseRejectBlock
    ) {
        guard let storageManager = config?.storageManager else {
            hedgeLog("Storage manager is not available in the config.")
            resolve(nil)
            return
        }
        setIdentify(storageManager, distinctId: distinctId, anonymousId: anonymousId)

        resolve(nil)
    }

    private func setIdentify(
        _ storageManager: PostHogStorageManager, distinctId: String, anonymousId: String
    ) {
        if !anonymousId.isEmpty {
            storageManager.setAnonymousId(anonymousId)
        }
        if !distinctId.isEmpty {
            storageManager.setDistinctId(distinctId)
        }
    }

    @objc(startRecording:withResolver:withRejecter:)
    func startRecording(
        resumeCurrent: Bool, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock
    ) {
        #if os(iOS)
            PostHogSDK.shared.startSessionRecording(resumeCurrent: resumeCurrent)
        #else
            logSessionReplayUnsupportedOnMacOS()
        #endif
        resolve(nil)
    }

    @objc(stopRecording:withRejecter:)
    func stopRecording(resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        #if os(iOS)
            PostHogSDK.shared.stopSessionRecording()
        #else
            logSessionReplayUnsupportedOnMacOS()
        #endif
        resolve(nil)
    }

    @objc(addExceptionStep:withProperties:withResolver:withRejecter:)
    func addExceptionStep(
        message: String, properties: [String: Any]?, resolve: RCTPromiseResolveBlock,
        reject _: RCTPromiseRejectBlock
    ) {
        PostHogSDK.shared.addExceptionStep(message, properties: properties)
        resolve(nil)
    }
}
