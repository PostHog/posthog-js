package com.posthogreactnativeplugin

import com.facebook.react.bridge.JavaOnlyMap
import com.posthog.android.PostHogAndroidConfig
import com.posthog.android.replay.PostHogScreenshotColorMode
import com.posthog.android.replay.PostHogSessionReplayConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PosthogReactNativePluginModuleTest {

  @Test
  fun `JVM and NDK crash capture are configured independently`() {
    for (nativeAutocapture in listOf(true, false)) {
      for (androidNdkCrashes in listOf(true, false)) {
        val config = PostHogAndroidConfig("api-key", "https://us.i.posthog.com")
        config.errorTrackingConfig.autoCapture = !nativeAutocapture
        config.errorTrackingConfig.captureNativeCrashes = !androidNdkCrashes

        config.applyErrorTrackingConfig(nativeAutocapture, androidNdkCrashes)

        assertEquals(nativeAutocapture, config.errorTrackingConfig.autoCapture)
        assertEquals(androidNdkCrashes, config.errorTrackingConfig.captureNativeCrashes)
      }
    }
  }

  @Test
  fun `touch capture defaults to true when omitted or malformed`() {
    for (map in listOf(null, JavaOnlyMap(), JavaOnlyMap.of("captureTouches", null), JavaOnlyMap.of("captureTouches", "false"))) {
      assertTrue(getBoolean(map, "captureTouches", true))
    }
  }

  @Test
  fun `touch capture reads explicit true and false`() {
    for (value in listOf(true, false)) {
      assertEquals(value, getBoolean(JavaOnlyMap.of("captureTouches", value), "captureTouches", true))
    }
  }

  @Test
  fun `screenshot mask alignment verification defaults to false when omitted`() {
    assertFalse(getBoolean(JavaOnlyMap(), "verifyScreenshotMaskAlignment", false))
  }

  @Test
  fun `screenshot mask alignment verification reads true`() {
    val sdkReplayConfig = JavaOnlyMap.of("verifyScreenshotMaskAlignment", true)

    assertTrue(getBoolean(sdkReplayConfig, "verifyScreenshotMaskAlignment", false))
  }

  @Test
  fun `omitted or malformed screenshot settings preserve native defaults`() {
    val maps =
      listOf(
        null,
        JavaOnlyMap(),
        JavaOnlyMap.of("screenshotScale", null, "screenshotCompressionQuality", null, "screenshotColorMode", null),
        JavaOnlyMap.of("screenshotScale", "half", "screenshotCompressionQuality", true, "screenshotColorMode", "unknown"),
      )
    for (map in maps) {
      val config = PostHogSessionReplayConfig()

      applyScreenshotConfig(map, config)

      assertEquals(1f, config.screenshotScale)
      assertEquals(30, config.screenshotCompressionQuality)
      assertEquals(PostHogScreenshotColorMode.ARGB_8888, config.screenshotColorMode)
    }
  }

  @Test
  fun `screenshot scale is independent and uses native clamping without float overflow`() {
    val cases = listOf(0.5 to 0.5f, 0.0 to 0.1f, -Double.MAX_VALUE to 0.1f, Double.MAX_VALUE to 1f)
    for ((value, expected) in cases) {
      val config = PostHogSessionReplayConfig()

      applyScreenshotConfig(JavaOnlyMap.of("screenshotScale", value), config)

      assertEquals(expected, config.screenshotScale)
      assertEquals(30, config.screenshotCompressionQuality)
      assertEquals(PostHogScreenshotColorMode.ARGB_8888, config.screenshotColorMode)
    }
  }

  @Test
  fun `non-finite screenshot scale uses full resolution`() {
    for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
      val config = PostHogSessionReplayConfig()

      applyScreenshotConfig(JavaOnlyMap.of("screenshotScale", value), config)

      assertEquals(1f, config.screenshotScale)
    }
  }

  @Test
  fun `compression quality is independent and uses native clamping`() {
    val cases = listOf(0.0 to 0, 80.9 to 80, -Double.MAX_VALUE to 0, Double.MAX_VALUE to 100)
    for ((value, expected) in cases) {
      val config = PostHogSessionReplayConfig()

      applyScreenshotConfig(JavaOnlyMap.of("screenshotCompressionQuality", value), config)

      assertEquals(expected, config.screenshotCompressionQuality)
      assertEquals(1f, config.screenshotScale)
      assertEquals(PostHogScreenshotColorMode.ARGB_8888, config.screenshotColorMode)
    }
  }

  @Test
  fun `non-finite quality preserves the native default without dropping other settings`() {
    for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
      val config = PostHogSessionReplayConfig()

      applyScreenshotConfig(JavaOnlyMap.of("screenshotCompressionQuality", value, "screenshotScale", 0.5), config)

      assertEquals(30, config.screenshotCompressionQuality)
      assertEquals(0.5f, config.screenshotScale)
    }
  }

  @Test
  fun `screenshot controls can be combined`() {
    val config = PostHogSessionReplayConfig()
    val map = JavaOnlyMap.of("screenshotScale", 0.5, "screenshotCompressionQuality", 50.0, "screenshotColorMode", "RGB_565")

    applyScreenshotConfig(map, config)

    assertEquals(0.5f, config.screenshotScale)
    assertEquals(50, config.screenshotCompressionQuality)
    assertEquals(PostHogScreenshotColorMode.RGB_565, config.screenshotColorMode)
  }

  @Test
  fun `ARGB color mode can be selected explicitly`() {
    val config = PostHogSessionReplayConfig().apply { screenshotColorMode = PostHogScreenshotColorMode.RGB_565 }

    applyScreenshotConfig(JavaOnlyMap.of("screenshotColorMode", "ARGB_8888"), config)

    assertEquals(PostHogScreenshotColorMode.ARGB_8888, config.screenshotColorMode)
  }

  @Test
  fun `iso 8601 timestamps from JS round-trip to the same instant`() {
    val parsed = parseIso8601("2026-09-22T10:11:12.134Z")
    assertNotNull(parsed)
    assertEquals(1790071872134L, parsed!!.time)
  }

  @Test
  fun `malformed or empty timestamps are rejected rather than defaulting to now`() {
    for (value in listOf("", "not-a-date", "2026-09-22", "2026-09-22T10:11:12Z", "2026-13-45T99:99:99.999Z")) {
      assertNull("expected $value to be rejected", parseIso8601(value))
    }
  }
}
