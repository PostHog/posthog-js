import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The package 'posthog-react-native-plugin' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

const PosthogReactNativePlugin = NativeModules.PosthogReactNativePlugin
  ? NativeModules.PosthogReactNativePlugin
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export type PostHogReactNativePluginMap = { [key: string]: any };

export interface PostHogReactNativePluginSessionReplayConfig {
  enabled?: boolean;
  sdkReplayConfig?: PostHogReactNativePluginMap;
  decideReplayConfig?: PostHogReactNativePluginMap;
}

export interface PostHogReactNativePluginErrorTrackingConfig {
  nativeAutocapture?: boolean;
}

export interface PostHogReactNativePluginConfig {
  sessionReplay?: PostHogReactNativePluginSessionReplayConfig;
  errorTracking?: PostHogReactNativePluginErrorTrackingConfig;
}

export function setup(
  sessionId: string,
  sdkOptions: PostHogReactNativePluginMap,
  pluginConfig: PostHogReactNativePluginConfig = {}
): Promise<void> {
  return PosthogReactNativePlugin.setup(sessionId, sdkOptions, pluginConfig);
}

export function start(
  sessionId: string,
  sdkOptions: PostHogReactNativePluginMap,
  sdkReplayConfig: PostHogReactNativePluginMap,
  decideReplayConfig: PostHogReactNativePluginMap
): Promise<void> {
  return PosthogReactNativePlugin.start(
    sessionId,
    sdkOptions,
    sdkReplayConfig,
    decideReplayConfig
  );
}

export function startSession(sessionId: string): Promise<void> {
  return PosthogReactNativePlugin.startSession(sessionId);
}

export function endSession(): Promise<void> {
  return PosthogReactNativePlugin.endSession();
}

export function isEnabled(): Promise<boolean> {
  return PosthogReactNativePlugin.isEnabled();
}

export function identify(
  distinctId: string,
  anonymousId: string
): Promise<void> {
  return PosthogReactNativePlugin.identify(distinctId, anonymousId);
}

export function startRecording(resumeCurrent: boolean): Promise<void> {
  return PosthogReactNativePlugin.startRecording(resumeCurrent);
}

export function stopRecording(): Promise<void> {
  return PosthogReactNativePlugin.stopRecording();
}

export interface PostHogReactNativePluginModule {
  setup: (
    sessionId: string,
    sdkOptions: PostHogReactNativePluginMap,
    pluginConfig?: PostHogReactNativePluginConfig
  ) => Promise<void>;

  /**
   * Legacy session replay setup entrypoint. Prefer setup() for new native features.
   */
  start: (
    sessionId: string,
    sdkOptions: PostHogReactNativePluginMap,
    sdkReplayConfig: PostHogReactNativePluginMap,
    decideReplayConfig: PostHogReactNativePluginMap
  ) => Promise<void>;

  startSession: (sessionId: string) => Promise<void>;

  endSession: () => Promise<void>;

  isEnabled: () => Promise<boolean>;

  identify: (distinctId: string, anonymousId: string) => Promise<void>;

  startRecording: (resumeCurrent: boolean) => Promise<void>;

  stopRecording: () => Promise<void>;
}

const PostHogReactNativePlugin: PostHogReactNativePluginModule = {
  setup,
  start,
  startSession,
  endSession,
  isEnabled,
  identify,
  startRecording,
  stopRecording,
};

export default PostHogReactNativePlugin;
