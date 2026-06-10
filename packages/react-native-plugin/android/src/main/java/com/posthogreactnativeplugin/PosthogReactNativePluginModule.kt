package com.posthogreactnativeplugin

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
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

          val config =
            PostHogAndroidConfig(apiKey, host).apply {
              debug = debugValue
              captureDeepLinks = false
              captureApplicationLifecycleEvents = false
              captureScreenViews = false
              flushAt = theFlushAt
              errorTrackingConfig.autoCapture = nativeErrorTrackingAutocapture

              if (sessionReplayEnabled) {
                val maskAllTextInputs = getBoolean(sdkReplayConfig, "maskAllTextInputs", DEFAULT_MASK_ALL_TEXT_INPUTS)
                val maskAllImages = getBoolean(sdkReplayConfig, "maskAllImages", DEFAULT_MASK_ALL_IMAGES)
                val captureLog = getBoolean(sdkReplayConfig, "captureLog", DEFAULT_CAPTURE_LOG)

                // read throttleDelayMs and use androidDebouncerDelayMs as a fallback for back compatibility
                val throttleDelayMs =
                  when {
                    hasKey(sdkReplayConfig, "throttleDelayMs") -> getInt(sdkReplayConfig, "throttleDelayMs", DEFAULT_THROTTLE_DELAY_MS)
                    hasKey(sdkReplayConfig, "androidDebouncerDelayMs") -> getInt(sdkReplayConfig, "androidDebouncerDelayMs", DEFAULT_THROTTLE_DELAY_MS)
                    else -> DEFAULT_THROTTLE_DELAY_MS
                  }

                sessionReplay = true
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
              }

              if (theSdkVersion.isNotEmpty()) {
                sdkName = "posthog-react-native"
                sdkVersion = theSdkVersion
              }
            }
          PostHogAndroid.setup(context, config)

          setIdentify(config.cachePreferences, distinctId, anonymousId)
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

  companion object {
    const val NAME = "PosthogReactNativePlugin"
    const val POSTHOG_TAG = "PostHog"

    // Default session replay configuration values
    const val DEFAULT_MASK_ALL_TEXT_INPUTS = true
    const val DEFAULT_MASK_ALL_IMAGES = true
    const val DEFAULT_CAPTURE_LOG = true
    const val DEFAULT_FLUSH_AT = 20
    const val DEFAULT_THROTTLE_DELAY_MS = 1000
  }
}
