package com.posthogreactnativeplugin

import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.JavascriptException
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.posthog.PostHog
import com.posthog.PostHogConfig
import com.posthog.android.PostHogAndroid
import com.posthog.android.PostHogAndroidConfig
import com.posthog.internal.PostHogPreferences
import com.posthog.internal.PostHogPreferences.Companion.ANONYMOUS_ID
import com.posthog.internal.PostHogPreferences.Companion.DISTINCT_ID
import com.posthog.internal.PostHogSessionManager
import java.util.UUID

class PosthogReactNativePluginModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  @ReactMethod
  fun setup(
    sessionId: String,
    sdkOptions: ReadableMap,
    pluginConfig: ReadableMap,
    promise: Promise,
  ) {
    val sessionReplayConfig = getMap(pluginConfig, "sessionReplay")
    val errorTrackingConfig = getMap(pluginConfig, "errorTracking")

    setupNativeSdk(
      method = "setup",
      sessionId = sessionId,
      sdkOptions = sdkOptions,
      sessionReplayEnabled = getBoolean(sessionReplayConfig, "enabled", false),
      sdkReplayConfig = getMap(sessionReplayConfig, "sdkReplayConfig"),
      decideReplayConfig = getMap(sessionReplayConfig, "decideReplayConfig"),
      nativeErrorTrackingAutocapture = getBoolean(errorTrackingConfig, "nativeAutocapture", false),
      exceptionStepsConfig = getMap(errorTrackingConfig, "exceptionSteps"),
      pushConfig = getMap(pluginConfig, "push"),
      promise = promise,
    )
  }

  @ReactMethod
  fun start(
    sessionId: String,
    sdkOptions: ReadableMap,
    sdkReplayConfig: ReadableMap,
    decideReplayConfig: ReadableMap,
    promise: Promise,
  ) {
    setupNativeSdk(
      method = "start",
      sessionId = sessionId,
      sdkOptions = sdkOptions,
      sessionReplayEnabled = true,
      sdkReplayConfig = sdkReplayConfig,
      decideReplayConfig = decideReplayConfig,
      nativeErrorTrackingAutocapture = false,
      exceptionStepsConfig = null,
      pushConfig = null,
      promise = promise,
    )
  }

  private fun setupNativeSdk(
    method: String,
    sessionId: String,
    sdkOptions: ReadableMap,
    sessionReplayEnabled: Boolean,
    sdkReplayConfig: ReadableMap?,
    decideReplayConfig: ReadableMap?,
    nativeErrorTrackingAutocapture: Boolean,
    exceptionStepsConfig: ReadableMap?,
    pushConfig: ReadableMap?,
    promise: Promise,
  ) {
    val initRunnable =
      Runnable {
        try {
          val uuid = UUID.fromString(sessionId)
          PostHogSessionManager.setSessionId(uuid)

          val context = this.reactApplicationContext
          val apiKey = getString(sdkOptions, "apiKey", "")
          val host = getString(sdkOptions, "host", PostHogConfig.DEFAULT_HOST)
          val debugValue = getBoolean(sdkOptions, "debug", false)
          val distinctId = getString(sdkOptions, "distinctId", "")
          val anonymousId = getString(sdkOptions, "anonymousId", "")
          val theSdkVersion = getString(sdkOptions, "sdkVersion", "")
          val theFlushAt = getInt(sdkOptions, "flushAt", DEFAULT_FLUSH_AT)
          val theOptOut = getBoolean(sdkOptions, "optOut", false)
          // Default true: an older JS layer that never sends this keeps native's own fetch.
          val thePreloadFeatureFlags = getBoolean(sdkOptions, "preloadFeatureFlags", true)

          // Forward custom headers (e.g. Authorization for a reverse proxy) so the native SDK
          // attaches them to the requests it sends directly (session replay, crash uploads).
          val theRequestHeaders =
            getMap(sdkOptions, "requestHeaders")
              ?.toHashMap()
              ?.filterValues { it is String }
              ?.mapValues { it.value as String }

          val config =
            PostHogAndroidConfig(apiKey, host).apply {
              debug = debugValue
              optOut = theOptOut
              preloadFeatureFlags = thePreloadFeatureFlags
              captureDeepLinks = false
              captureApplicationLifecycleEvents = false
              captureScreenViews = false
              flushAt = theFlushAt
              theRequestHeaders?.let { requestHeaders = it }
              errorTrackingConfig.autoCapture = nativeErrorTrackingAutocapture

              // Keep the native exception-steps buffer aligned with the JS layer (one logical buffer).
              // Absent keys fall back to the native defaults the helpers receive.
              errorTrackingConfig.exceptionSteps.enabled =
                getBoolean(exceptionStepsConfig, "enabled", errorTrackingConfig.exceptionSteps.enabled)
              errorTrackingConfig.exceptionSteps.maxBytes =
                getInt(exceptionStepsConfig, "maxBytes", errorTrackingConfig.exceptionSteps.maxBytes)

              // React Native rethrows fatal JS errors natively as JavascriptException.
              // The JS layer already captured them, so drop the native duplicate.
              errorTrackingConfig.ignoredExceptionTypes.add(JavascriptException::class.java)

              // Always apply the session replay configuration so that recording started later
              // (e.g. startRecording or a linked feature flag) uses the right mode and masking;
              // sessionReplayEnabled only controls whether recording starts at setup.
              val maskAllTextInputs = getBoolean(sdkReplayConfig, "maskAllTextInputs", DEFAULT_MASK_ALL_TEXT_INPUTS)
              val maskAllImages = getBoolean(sdkReplayConfig, "maskAllImages", DEFAULT_MASK_ALL_IMAGES)
              val captureLog = getBoolean(sdkReplayConfig, "captureLog", DEFAULT_CAPTURE_LOG)

              // read throttleDelayMs and use androidDebouncerDelayMs as a fallback for back compatibility
              val throttleDelayMs =
                when {
                  hasKey(sdkReplayConfig, "throttleDelayMs") -> getInt(sdkReplayConfig, "throttleDelayMs", DEFAULT_THROTTLE_DELAY_MS)
                  hasKey(
                    sdkReplayConfig,
                    "androidDebouncerDelayMs",
                  ) -> getInt(sdkReplayConfig, "androidDebouncerDelayMs", DEFAULT_THROTTLE_DELAY_MS)
                  else -> DEFAULT_THROTTLE_DELAY_MS
                }

              sessionReplay = sessionReplayEnabled
              sessionReplayConfig.screenshot = true
              sessionReplayConfig.captureLogcat = captureLog
              sessionReplayConfig.throttleDelayMs = throttleDelayMs.toLong()
              sessionReplayConfig.maskAllImages = maskAllImages
              sessionReplayConfig.maskAllTextInputs = maskAllTextInputs
              sessionReplayConfig.sampleRate = getDoubleOrNull(sdkReplayConfig, "sampleRate")

              val endpoint = getString(decideReplayConfig, "endpoint", "")
              if (endpoint.isNotEmpty()) {
                snapshotEndpoint = endpoint
              }

              // Only set when present: the legacy start() path predates push, and there the
              // native defaults (both true) must win, matching posthog-android on its own.
              if (hasKey(pushConfig, "capturePushNotificationSubscriptions")) {
                capturePushNotificationSubscriptions =
                  getBoolean(pushConfig, "capturePushNotificationSubscriptions", true)
              }
              if (hasKey(pushConfig, "capturePushNotificationOpened")) {
                capturePushNotificationOpened = getBoolean(pushConfig, "capturePushNotificationOpened", true)
              }

              // Installed only when JS asked for it: an uninvited bridging provider would
              // change how the native SDK handles a 401 on the subscription call.
              if (getBoolean(pushConfig, "pushIdentityProviderEnabled", false)) {
                pushModule = this@PosthogReactNativePluginModule
                pushIdentityProvider = { distinctId, appId, completion ->
                  requestPushIdentityToken(distinctId, appId, completion)
                }
              }

              if (theSdkVersion.isNotEmpty()) {
                sdkName = "posthog-react-native"
                sdkVersion = theSdkVersion
              }
            }
          PostHogAndroid.setup(context, config)

          setIdentify(config.cachePreferences, distinctId, anonymousId)

          captureColdStartPushOpenIfNeeded(config)
        } catch (e: Throwable) {
          logError(method, e)
        } finally {
          promise.resolve(null)
        }
      }

    // forces the SDK to be initialized on the main thread
    if (UiThreadUtil.isOnUiThread()) {
      initRunnable.run()
    } else {
      UiThreadUtil.runOnUiThread(initRunnable)
    }
  }

  @ReactMethod
  fun startSession(
    sessionId: String,
    promise: Promise,
  ) {
    try {
      val uuid = UUID.fromString(sessionId)
      PostHogSessionManager.setSessionId(uuid)
      PostHog.startSession()
    } catch (e: Throwable) {
      logError("startSession", e)
    } finally {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun isEnabled(promise: Promise) {
    try {
      promise.resolve(PostHog.isSessionReplayActive())
    } catch (e: Throwable) {
      logError("isEnabled", e)
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun endSession(promise: Promise) {
    try {
      PostHog.endSession()
    } catch (e: Throwable) {
      logError("endSession", e)
    } finally {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun identify(
    distinctId: String,
    anonymousId: String,
    promise: Promise,
  ) {
    try {
      setIdentify(PostHog.getConfig<PostHogConfig>()?.cachePreferences, distinctId, anonymousId)
    } catch (e: Throwable) {
      logError("identify", e)
    } finally {
      promise.resolve(null)
    }
  }

  // Calls the native SDK rather than writing preferences like identify() does: reset() is what
  // unregisters the logged-out user's push subscription and re-registers under the new identity.
  @ReactMethod
  fun reset(
    distinctId: String,
    anonymousId: String,
    promise: Promise,
  ) {
    try {
      PostHog.reset()
      // Native reset() mints its own anonymous id; overwrite it with the JS one so the two
      // SDKs stay on the same identity. Must run after reset(), which needs the pre-reset
      // distinctId to know which subscription to unregister. Known gap (as on iOS): native's
      // async push re-registration can read the identity before this write lands and register
      // under a throwaway id; retryPending() converges it on the next flush.
      setIdentify(PostHog.getConfig<PostHogConfig>()?.cachePreferences, distinctId, anonymousId)
    } catch (e: Throwable) {
      logError("reset", e)
    } finally {
      promise.resolve(null)
    }
  }

  // Runtime consent changes must reach native: it persists its own opt-out flag and only reads
  // the JS value at setup(), so a refreshed FCM token could otherwise auto-register after the
  // user opted out. optIn() also resumes deferred push work on the next flush.
  @ReactMethod
  fun setOptOut(
    optOut: Boolean,
    promise: Promise,
  ) {
    try {
      if (optOut) {
        PostHog.optOut()
      } else {
        PostHog.optIn()
      }
    } catch (e: Throwable) {
      logError("setOptOut", e)
    } finally {
      promise.resolve(null)
    }
  }

  private fun setIdentify(
    cachePreferences: PostHogPreferences?,
    distinctId: String,
    anonymousId: String,
  ) {
    cachePreferences?.let { preferences ->
      if (anonymousId.isNotEmpty()) {
        preferences.setValue(ANONYMOUS_ID, anonymousId)
      }
      if (distinctId.isNotEmpty()) {
        preferences.setValue(DISTINCT_ID, distinctId)
      }
    }
  }

  @ReactMethod
  fun startRecording(
    resumeCurrent: Boolean,
    promise: Promise,
  ) {
    try {
      PostHog.startSessionReplay(resumeCurrent)
    } catch (e: Throwable) {
      logError("startRecording", e)
    } finally {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    try {
      PostHog.stopSessionReplay()
    } catch (e: Throwable) {
      logError("stopRecording", e)
    } finally {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun addExceptionStep(
    message: String,
    properties: ReadableMap?,
    promise: Promise,
  ) {
    try {
      // ReadableMap.toHashMap() is HashMap<String, Any?>; the native API takes Map<String, Any>?.
      @Suppress("UNCHECKED_CAST")
      val nativeProperties = properties?.toHashMap() as Map<String, Any>?
      PostHog.addExceptionStep(message, nativeProperties)
    } catch (e: Throwable) {
      logError("addExceptionStep", e)
    } finally {
      promise.resolve(null)
    }
  }

  private fun getMap(
    map: ReadableMap?,
    key: String,
  ): ReadableMap? =
    runCatching {
      if (map != null && map.hasKey(key) && !map.isNull(key)) {
        map.getMap(key)
      } else {
        null
      }
    }.getOrNull()

  private fun hasKey(
    map: ReadableMap?,
    key: String,
  ): Boolean = runCatching { map != null && map.hasKey(key) && !map.isNull(key) }.getOrDefault(false)

  private fun getBoolean(
    map: ReadableMap?,
    key: String,
    default: Boolean,
  ): Boolean = runCatching { if (hasKey(map, key)) map?.getBoolean(key) ?: default else default }.getOrDefault(default)

  private fun getString(
    map: ReadableMap?,
    key: String,
    default: String,
  ): String = runCatching { if (hasKey(map, key)) map?.getString(key) ?: default else default }.getOrDefault(default)

  private fun getInt(
    map: ReadableMap?,
    key: String,
    default: Int,
  ): Int = runCatching { if (hasKey(map, key)) map?.getInt(key) ?: default else default }.getOrDefault(default)

  private fun getDoubleOrNull(
    map: ReadableMap?,
    key: String,
  ): Double? = runCatching { if (hasKey(map, key)) map?.getDouble(key) else null }.getOrNull()

  private fun logError(
    method: String,
    error: Throwable,
  ) {
    Log.println(Log.ERROR, POSTHOG_TAG, "Method $method, error: $error")
  }

  // These reject instead of this module's usual swallow-and-resolve convention: a failed
  // registration is a distinct signal, not a silent success. The JS layer's public methods
  // never throw, so the rejection is what gives it something to log.
  @ReactMethod
  fun registerPushNotificationToken(
    deviceToken: String?,
    appId: String?,
    promise: Promise,
  ) {
    try {
      if (deviceToken.isNullOrBlank()) {
        // A blank token is dropped silently by the native SDK, so surface it here
        // instead of reporting false success.
        promise.reject(
          PUSH_ERROR_CODE,
          "registerPushNotificationToken: deviceToken is blank; token not registered.",
        )
        return
      }
      val resolvedAppId = appId?.trim()?.takeIf { it.isNotEmpty() } ?: firebaseProjectId
      if (resolvedAppId.isNullOrEmpty()) {
        val message =
          "registerPushNotificationToken: no appId provided and no Firebase project id " +
            "could be resolved, skipping. Pass appId explicitly if this app does not use Firebase."
        Log.w(POSTHOG_TAG, message)
        promise.reject(PUSH_ERROR_CODE, message)
        return
      }
      PostHog.registerPushNotificationToken(deviceToken, resolvedAppId)
      promise.resolve(null)
    } catch (e: Throwable) {
      logError("registerPushNotificationToken", e)
      promise.reject(PUSH_ERROR_CODE, e)
    }
  }

  @ReactMethod
  fun unregisterPushNotificationToken(promise: Promise) {
    try {
      PostHog.unregisterPushNotificationToken()
      promise.resolve(null)
    } catch (e: Throwable) {
      logError("unregisterPushNotificationToken", e)
      promise.reject(PUSH_ERROR_CODE, e)
    }
  }

  @ReactMethod
  fun capturePushNotificationOpened(
    properties: ReadableMap,
    promise: Promise,
  ) {
    try {
      // subtitle is iOS-only; posthog-android's capturePushNotificationOpened has no
      // subtitle parameter, so JS's value is dropped here.
      val title = if (hasKey(properties, "title")) properties.getString("title") else null
      val body = if (hasKey(properties, "body")) properties.getString("body") else null
      val payload = if (hasKey(properties, "payload")) properties.getMap("payload")?.toHashMap() else null
      val action = if (hasKey(properties, "action")) properties.getString("action") else null
      PostHog.capturePushNotificationOpened(title, body, payload, action)
      promise.resolve(null)
    } catch (e: Throwable) {
      logError("capturePushNotificationOpened", e)
      promise.reject(PUSH_ERROR_CODE, e)
    }
  }

  // posthog-android's open-capture integration registers ActivityLifecycleCallbacks during
  // setup(), which the bridge reaches only after the launch Activity was created — so the
  // cold-start tray tap it exists for is the one creation it can never observe here. Read
  // the launch intent directly, then strip the marker so the integration (or a re-run)
  // can't capture the same tap again from this intent object.
  private fun captureColdStartPushOpenIfNeeded(config: PostHogAndroidConfig) {
    if (!config.capturePushNotificationOpened) {
      return
    }
    val intent = currentActivity?.intent ?: return
    // A relaunch from recents redelivers the original tray intent to a fresh activity;
    // capturing it would count a days-old tap as a new open.
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) {
      return
    }
    try {
      intent.getStringExtra(GOOGLE_MESSAGE_ID) ?: return
      // Unmarshalling extras throws BadParcelableException on a Parcelable class this
      // classloader lacks; read before stripping the marker so a failed read leaves the
      // intent as the native integration expects it.
      val payload =
        intent.extras?.let { bundle ->
          bundle.keySet().associateWith { key ->
            @Suppress("DEPRECATION")
            bundle.get(key)
          }
        }
      intent.removeExtra(GOOGLE_MESSAGE_ID)
      PostHog.capturePushNotificationOpened(null, null, payload, null)
    } catch (e: Throwable) {
      logError("capturePushNotificationOpened", e)
    }
  }

  @ReactMethod
  fun providePushIdentityToken(
    requestId: String?,
    token: String?,
    promise: Promise,
  ) {
    try {
      if (requestId != null) {
        pushIdentityCompletions.remove(requestId)?.invoke(token)
      }
    } catch (e: Throwable) {
      logError("providePushIdentityToken", e)
    } finally {
      promise.resolve(null)
    }
  }

  // Required by NativeEventEmitter on the old architecture; events are broadcast via
  // RCTDeviceEventEmitter, so there is nothing to do here.
  @ReactMethod
  fun addListener(eventName: String?) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  override fun invalidate() {
    if (pushModule === this) {
      // Decline mints fast after teardown instead of stalling the native 10s watchdog.
      pushModule = null
    }
    super.invalidate()
  }

  companion object {
    const val NAME = "PosthogReactNativePlugin"
    const val POSTHOG_TAG = "PostHog"

    // FCM stamps this extra on the tray-tap launch intent; mirrors posthog-android's
    // PostHogActivityLifecycleCallbackIntegration.
    private const val GOOGLE_MESSAGE_ID = "google.message_id"

    // Default session replay configuration values
    const val DEFAULT_MASK_ALL_TEXT_INPUTS = true
    const val DEFAULT_MASK_ALL_IMAGES = true
    const val DEFAULT_CAPTURE_LOG = true
    const val DEFAULT_FLUSH_AT = 20
    const val DEFAULT_THROTTLE_DELAY_MS = 1000

    private const val PUSH_ERROR_CODE = "PosthogReactNativePluginError"
    private const val PUSH_IDENTITY_EVENT = "PostHogPushIdentityRequest"
    private const val PUSH_IDENTITY_REPLY_TTL_MS = 15_000L

    // Modules die on every bridge reload, so the provider closure resolves the live
    // module through this static reference at call time, not a captured setup-time one.
    @Volatile
    private var pushModule: PosthogReactNativePluginModule? = null

    private val pushIdentityCompletions = java.util.concurrent.ConcurrentHashMap<String, (String?) -> Unit>()

    private fun requestPushIdentityToken(
      distinctId: String,
      appId: String,
      completion: (String?) -> Unit,
    ) {
      val module = pushModule
      val context = module?.reactApplicationContext
      if (module == null || context == null || !context.hasActiveReactInstance()) {
        declinePushIdentity(completion, "no React instance attached")
        return
      }
      val requestId = UUID.randomUUID().toString()
      pushIdentityCompletions[requestId] = completion
      try {
        val params =
          Arguments.createMap().apply {
            putString("requestId", requestId)
            putString("distinctId", distinctId)
            putString("appId", appId)
          }
        context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(PUSH_IDENTITY_EVENT, params)
      } catch (e: Throwable) {
        pushIdentityCompletions.remove(requestId)
        declinePushIdentity(completion, "failed to reach JS: ${e.message}")
        return
      }
      // The native SDK's own 10s mint watchdog handles the fallback; this only drops the
      // entry so a late JS reply is ignored and the completion doesn't leak.
      UiThreadUtil.runOnUiThread({ pushIdentityCompletions.remove(requestId) }, PUSH_IDENTITY_REPLY_TTL_MS)
    }

    // A null identity token sends the request unauthenticated, which a project requiring
    // identity verification rejects server-side. Log the reason so that failure is
    // greppable and distinct from a host that deliberately returned null.
    private fun declinePushIdentity(
      completion: (String?) -> Unit,
      reason: String,
    ) {
      Log.w(POSTHOG_TAG, "Push subscription will be sent unauthenticated: $reason")
      completion(null)
    }

    @Volatile private var cachedFirebaseProjectId: String? = null

    // No Firebase dependency here, so the project id is looked up reflectively and any
    // failure (class missing, Firebase not initialized) is swallowed. Only a successful lookup
    // is cached: getInstance() throws until Firebase initializes, so memoizing the null would
    // strand every later token-refresh call with no resolvable appId for the process lifetime.
    private val firebaseProjectId: String?
      get() =
        cachedFirebaseProjectId
          ?: try {
            val firebaseAppClass = Class.forName("com.google.firebase.FirebaseApp")
            val firebaseApp = firebaseAppClass.getMethod("getInstance").invoke(null)
            val options = firebaseAppClass.getMethod("getOptions").invoke(firebaseApp)
            (options?.javaClass?.getMethod("getProjectId")?.invoke(options) as? String)?.also {
              cachedFirebaseProjectId = it
            }
          } catch (e: Throwable) {
            null
          }
  }
}
