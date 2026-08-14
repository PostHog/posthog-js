package com.posthogreactnativeplugin

import com.facebook.react.bridge.JavaOnlyMap
import com.posthog.android.replay.PostHogSessionReplayConfig
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PosthogReactNativePluginModuleTest {
  @Test
  fun `screenshot mask alignment verification defaults to false when omitted`() {
    val sessionReplayConfig = PostHogSessionReplayConfig()

    applyVerifyScreenshotMaskAlignment(sessionReplayConfig, JavaOnlyMap())

    assertFalse(sessionReplayConfig.verifyScreenshotMaskAlignment)
  }

  @Test
  fun `screenshot mask alignment verification forwards true`() {
    val sessionReplayConfig = PostHogSessionReplayConfig()
    val sdkReplayConfig = JavaOnlyMap.of("verifyScreenshotMaskAlignment", true)

    applyVerifyScreenshotMaskAlignment(sessionReplayConfig, sdkReplayConfig)

    assertTrue(sessionReplayConfig.verifyScreenshotMaskAlignment)
  }
}
