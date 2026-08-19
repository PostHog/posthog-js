import PostHog
import React

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

// A nil identity token sends the request unauthenticated, which a project requiring
// identity verification rejects server-side. Log the reason so that failure is greppable
// and distinct from a host that deliberately returned nil.
private func declinePushIdentity(_ completion: (String?) -> Void, _ reason: String) {
    hedgeLog("Push subscription will be sent unauthenticated: \(reason)")
    completion(nil)
}

@objc(PosthogReactNativePlugin)
public class PosthogReactNativePlugin: RCTEventEmitter {
    private var config: PostHogConfig?

    private static let pushIdentityEvent = "PostHogPushIdentityRequest"

    // This module dies on every bridge reload, so the provider closure resolves the live
    // module through this static weak reference at call time, not a captured setup-time one.
    private static weak var pushInstance: PosthogReactNativePlugin?

    // Main-thread confined, like the rest of the identity-request bookkeeping below.
    private var hasPushListeners = false
    private var pushIdentityCompletions: [String: (String?) -> Void] = [:]

    public override func supportedEvents() -> [String]! {
        [PosthogReactNativePlugin.pushIdentityEvent]
    }

    public override func startObserving() {
        DispatchQueue.main.async { self.hasPushListeners = true }
    }

    public override func stopObserving() {
        DispatchQueue.main.async { self.hasPushListeners = false }
    }

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
            pushConfig: pluginConfig["push"] as? [String: Any] ?? [:],
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
            pushConfig: [:],
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
        pushConfig: [String: Any],
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

        config.optOut = sdkOptions["optOut"] as? Bool ?? false
        // JS owns flags; it tells us when the native preload would be a duplicate. posthog-ios
        // has no remoteConfig switch to mirror — it deprecated the option and always loads.
        config.preloadFeatureFlags = sdkOptions["preloadFeatureFlags"] as? Bool ?? true

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

        // Only set when present: the legacy start() path predates push, and there the
        // native defaults (both true) must win, matching posthog-ios on its own.
        if let capturePushSubscriptions = pushConfig["capturePushNotificationSubscriptions"] as? Bool {
            config.capturePushNotificationSubscriptions = capturePushSubscriptions
        }
        if let capturePushOpened = pushConfig["capturePushNotificationOpened"] as? Bool {
            config.capturePushNotificationOpened = capturePushOpened
        }

        // Installed only when JS asked for it: an uninvited bridging provider would change
        // how the native SDK handles a 401 on the subscription call.
        if pushConfig["pushIdentityProviderEnabled"] as? Bool == true {
            PosthogReactNativePlugin.pushInstance = self
            config.pushIdentityProvider = { distinctId, appId, completion in
                DispatchQueue.main.async {
                    guard let instance = PosthogReactNativePlugin.pushInstance, instance.hasPushListeners else {
                        declinePushIdentity(completion, "no JS listener attached")
                        return
                    }
                    let requestId = UUID().uuidString
                    instance.pushIdentityCompletions[requestId] = completion
                    instance.sendEvent(
                        withName: PosthogReactNativePlugin.pushIdentityEvent,
                        body: ["requestId": requestId, "distinctId": distinctId, "appId": appId]
                    )
                    // The native SDK's own 10s mint watchdog handles the fallback; this only
                    // drops the entry so a late JS reply is ignored and the closure doesn't leak.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak instance] in
                        instance?.pushIdentityCompletions.removeValue(forKey: requestId)
                    }
                }
            }
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

    // Calls the native SDK rather than writing storage like identify() does: reset() is what
    // unregisters the logged-out user's push subscription and re-registers under the new identity.
    @objc(reset:withAnonymousId:withResolver:withRejecter:)
    func reset(
        distinctId: String, anonymousId: String, resolve: RCTPromiseResolveBlock,
        reject _: RCTPromiseRejectBlock
    ) {
        PostHogSDK.shared.reset()
        // Native reset() mints its own anonymous id; overwrite it with the JS one so the two SDKs
        // stay on the same identity. Must run after reset(), which needs the pre-reset distinctId
        // to know which subscription to unregister.
        if let storageManager = config?.storageManager {
            setIdentify(storageManager, distinctId: distinctId, anonymousId: anonymousId)
        }
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

    // Runtime consent changes must reach native: it persists its own opt-out flag and only
    // reads the JS value at setup(), so a refreshed APNs token could otherwise auto-register
    // after the user opted out. optIn() also reinstalls the integrations opt-out removed.
    @objc(setOptOut:withResolver:withRejecter:)
    func setOptOut(
        optOut: Bool, resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock
    ) {
        if optOut {
            PostHogSDK.shared.optOut()
        } else {
            PostHogSDK.shared.optIn()
        }
        resolve(nil)
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

    @objc(registerPushNotificationToken:withAppId:withResolver:withRejecter:)
    func registerPushNotificationToken(
        deviceToken: String, appId: String?, resolve: RCTPromiseResolveBlock,
        reject: RCTPromiseRejectBlock
    ) {
        #if os(iOS)
            // A blank token is dropped silently by the native SDK, so surface it here
            // instead of reporting false success.
            if deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                reject("PosthogReactNativePluginError", "registerPushNotificationToken: deviceToken is blank; token not registered.", nil)
                return
            }
            PostHogSDK.shared.registerPushNotificationToken(deviceToken, appId: appId)
            resolve(nil)
        #else
            // posthog-ios push registration is iOS-only (the backend rejects the macos platform).
            _ = reject
            hedgeLog("registerPushNotificationToken is not supported on macOS; token not registered.")
            resolve(nil)
        #endif
    }

    @objc(unregisterPushNotificationToken:withRejecter:)
    func unregisterPushNotificationToken(resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock) {
        #if os(iOS)
            PostHogSDK.shared.unregisterPushNotificationToken()
        #else
            hedgeLog("unregisterPushNotificationToken is not supported on macOS; nothing to unregister.")
        #endif
        resolve(nil)
    }

    @objc(capturePushNotificationOpened:withResolver:withRejecter:)
    func capturePushNotificationOpened(
        properties: [String: Any], resolve: RCTPromiseResolveBlock, reject _: RCTPromiseRejectBlock
    ) {
        PostHogSDK.shared.capturePushNotificationOpened(
            title: properties["title"] as? String,
            subtitle: properties["subtitle"] as? String,
            body: properties["body"] as? String,
            payload: properties["payload"] as? [String: Any],
            action: properties["action"] as? String
        )
        resolve(nil)
    }

    @objc(providePushIdentityToken:withToken:withResolver:withRejecter:)
    func providePushIdentityToken(
        requestId: String, token: String?, resolve: RCTPromiseResolveBlock,
        reject _: RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let completion = self?.pushIdentityCompletions.removeValue(forKey: requestId) else {
                return
            }
            completion(token)
        }
        resolve(nil)
    }
}
