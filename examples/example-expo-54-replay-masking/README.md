# Android Session Replay Masking Test

Test app for verifying Android Session Replay text input masking behavior.

## Environment

| Package | Version |
|---|---|
| posthog-react-native | 4.37.6 |
| posthog-react-native-session-replay | 1.5.1 |
| posthog-android (transitive) | 3.34.3 |
| react-native | 0.81.5 |
| expo | ~54.0.27 |
| newArchEnabled | true |

## Config

```ts
sessionReplayConfig: {
    maskAllTextInputs: true,
    maskAllImages: false,
    captureLog: true,
    throttleDelayMs: 1000,
}
```

## Setup

1. Set up your `.env` with PostHog API key and host:
   ```
   EXPO_PUBLIC_POSTHOG_PROJECT_API_KEY=phc_xxx
   EXPO_PUBLIC_POSTHOG_API_HOST=https://us.i.posthog.com
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Run on an Android device/emulator:
   ```bash
   pnpm android
   ```

4. Navigate to the **"Replay Masking"** tab

5. Tap **"Check Replay Status"** to confirm session replay is active

6. Type into the various text inputs (red-bordered = should be masked, gray = control)

7. Check the session replay recording in PostHog

## Test Scenarios

The "Replay Masking" tab contains 5 sections:

1. **Control (no masking)** — Plain input, should be visible in replay
2. **PostHogMaskView wrapper** — Input inside `<PostHogMaskView>`, should be redacted
3. **Direct ph-no-capture** — Input with `accessibilityLabel="ph-no-capture"`, should be redacted
4. **Multiline in PostHogMaskView** — Multi-line text area, should be redacted
5. **Realistic Login Form** — Mix of masked and unmasked fields
