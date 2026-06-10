import PostHog

/// Meant for internally logging PostHog related things
private func hedgeLog(_ message: String) {
    print("[PostHog] \(message)")
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

        setupNativeSdk(
            method: "setup",
            sessionId: sessionId,
            sdkOptions: sdkOptions,
            sessionReplayEnabled: sessionReplayConfig["enabled"] as? Bool ?? false,
            sdkReplayConfig: sessionReplayConfig["sdkReplayConfig"] as? [String: Any] ?? [:],
            decideReplayConfig: sessionReplayConfig["decideReplayConfig"] as? [String: Any] ?? [:],
            nativeErrorTrackingAutocapture: errorTrackingConfig["nativeAutocapture"] as? Bool ?? false,
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

        if #available(iOS 15.0, *) {
            config.surveys = false
        }

        if sessionReplayEnabled {
            config.sessionReplay = true
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
        }

        let distinctId = sdkOptions["distinctId"] as? String ?? ""
        let anonymousId = sdkOptions["anonymousId"] as? String ?? ""

        let sdkVersion = sdkOptions["sdkVersion"] as? String ?? ""

        let flushAt = sdkOptions["flushAt"] as? Int ?? 20
        config.flushAt = flushAt

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
        let isEnabled = PostHogSDK.shared.isSessionReplayActive()
        resolve(isEnabled)
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
        PostHogSDK.shared.startSessionRecording(resumeCurrent: resumeCurrent)
        resolve(nil)
    }

    @objc(stopRecording:withRejecter:)
    func stopRecording(resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        PostHogSDK.shared.stopSessionRecording()
        resolve(nil)
    }
}
