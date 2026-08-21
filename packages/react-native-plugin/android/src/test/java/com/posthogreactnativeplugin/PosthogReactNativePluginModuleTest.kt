package com.posthogreactnativeplugin

import com.facebook.react.bridge.JavaOnlyMap
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PosthogReactNativePluginModuleTest {
  @Test
  fun `screenshot mask alignment verification defaults to false when omitted`() {
    assertFalse(getBoolean(JavaOnlyMap(), "verifyScreenshotMaskAlignment", false))
  }

  @Test
  fun `screenshot mask alignment verification reads true`() {
    val sdkReplayConfig = JavaOnlyMap.of("verifyScreenshotMaskAlignment", true)

    assertTrue(getBoolean(sdkReplayConfig, "verifyScreenshotMaskAlignment", false))
  }
}
