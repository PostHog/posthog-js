import { NativeEventEmitter, NativeModules, Platform } from 'react-native'
import type { EmitterSubscription } from 'react-native'

const LINKING_ERROR =
  `The package '@posthog/react-native-plugin' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n'

const PosthogReactNativePlugin = NativeModules.PosthogReactNativePlugin
  ? NativeModules.PosthogReactNativePlugin
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR)
        },
      }
    )

export type PostHogReactNativePluginMap = { [key: string]: any }

export interface PostHogReactNativePluginSessionReplayConfig {
  enabled?: boolean
  sdkReplayConfig?: PostHogReactNativePluginMap
  decideReplayConfig?: PostHogReactNativePluginMap
}

export interface PostHogReactNativePluginExceptionStepsConfig {
  enabled?: boolean
  maxBytes?: number
}

export interface PostHogReactNativePluginErrorTrackingConfig {
  nativeAutocapture?: boolean
  exceptionSteps?: PostHogReactNativePluginExceptionStepsConfig
}

export interface PostHogReactNativePluginPushConfig {
  capturePushNotificationSubscriptions?: boolean
  capturePushNotificationOpened?: boolean
  /**
   * A provider callback can't cross the bridge, so this only tells native whether to
   * install the bridging provider at all — installing one the host didn't ask for
   * would change how the native SDK handles a 401 on the subscription call.
   * Pair with {@link setPushIdentityProvider} before calling setup().
   */
  pushIdentityProviderEnabled?: boolean
}

export interface PostHogReactNativePluginConfig {
  sessionReplay?: PostHogReactNativePluginSessionReplayConfig
  errorTracking?: PostHogReactNativePluginErrorTrackingConfig
  push?: PostHogReactNativePluginPushConfig
}

export function setup(
  sessionId: string,
  sdkOptions: PostHogReactNativePluginMap,
  pluginConfig: PostHogReactNativePluginConfig = {}
): Promise<void> {
  return PosthogReactNativePlugin.setup(sessionId, sdkOptions, pluginConfig)
}

export function start(
  sessionId: string,
  sdkOptions: PostHogReactNativePluginMap,
  sdkReplayConfig: PostHogReactNativePluginMap,
  decideReplayConfig: PostHogReactNativePluginMap
): Promise<void> {
  return PosthogReactNativePlugin.start(sessionId, sdkOptions, sdkReplayConfig, decideReplayConfig)
}

export function startSession(sessionId: string): Promise<void> {
  return PosthogReactNativePlugin.startSession(sessionId)
}

export function endSession(): Promise<void> {
  return PosthogReactNativePlugin.endSession()
}

export function isEnabled(): Promise<boolean> {
  return PosthogReactNativePlugin.isEnabled()
}

export function identify(distinctId: string, anonymousId: string): Promise<void> {
  return PosthogReactNativePlugin.identify(distinctId, anonymousId)
}

/**
 * Resets the native SDK's identity on logout. Unlike {@link identify}, this calls the native
 * SDK's own `reset()`, which unregisters the logged-out user's push subscription and
 * re-registers it under the new anonymous id.
 */
export function reset(distinctId: string, anonymousId: string): Promise<void> {
  return PosthogReactNativePlugin.reset(distinctId, anonymousId)
}

export function startRecording(resumeCurrent: boolean): Promise<void> {
  return PosthogReactNativePlugin.startRecording(resumeCurrent)
}

export function stopRecording(): Promise<void> {
  return PosthogReactNativePlugin.stopRecording()
}

export function addExceptionStep(message: string, properties?: PostHogReactNativePluginMap): Promise<void> {
  return PosthogReactNativePlugin.addExceptionStep(message, properties ?? {})
}

export function registerPushNotificationToken(deviceToken: string, appId: string | null): Promise<void> {
  return PosthogReactNativePlugin.registerPushNotificationToken(deviceToken, appId)
}

export function unregisterPushNotificationToken(): Promise<void> {
  return PosthogReactNativePlugin.unregisterPushNotificationToken()
}

export function capturePushNotificationOpened(properties: PostHogReactNativePluginMap): Promise<void> {
  return PosthogReactNativePlugin.capturePushNotificationOpened(properties)
}

/**
 * Mints a signed identity-verification token for a push subscription request.
 * Return null to send the request without an identity token.
 */
export type PostHogPushIdentityProvider = (distinctId: string, appId: string) => Promise<string | null>

const PUSH_IDENTITY_EVENT = 'PostHogPushIdentityRequest'

let pushIdentitySubscription: EmitterSubscription | undefined

/**
 * Installs the JS side of the push identity-provider bridge. The native SDK asks for a
 * token via a `PostHogPushIdentityRequest` event; the reply is routed back with
 * `providePushIdentityToken`, keyed by the request id so late replies are ignored.
 *
 * Install before setup() with `push.pushIdentityProviderEnabled` set, so the native
 * config gets its bridging provider at SDK initialization. Any provider failure
 * degrades to a null token — an unauthenticated request — never a stalled mint.
 */
export function setPushIdentityProvider(provider: PostHogPushIdentityProvider): void {
  pushIdentitySubscription?.remove()
  // Via the proxy, not raw NativeModules: an unlinked module would build an emitter over
  // undefined and throw a generic RN error inside the SDK's init try, taking replay down with it.
  const emitter = new NativeEventEmitter(PosthogReactNativePlugin)
  pushIdentitySubscription = emitter.addListener(
    PUSH_IDENTITY_EVENT,
    async (request: { requestId: string; distinctId: string; appId: string }) => {
      let token: string | null = null
      try {
        const minted = await provider(request.distinctId, request.appId)
        token = typeof minted === 'string' ? minted : null
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[PostHog] pushIdentityProvider threw: ${e}. Push subscription will be sent unauthenticated.`)
      }
      try {
        await PosthogReactNativePlugin.providePushIdentityToken(request.requestId, token)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[PostHog] Failed to deliver push identity token to native: ${e}`)
      }
    }
  )
}

export interface PostHogReactNativePluginModule {
  setup: (
    sessionId: string,
    sdkOptions: PostHogReactNativePluginMap,
    pluginConfig?: PostHogReactNativePluginConfig
  ) => Promise<void>

  /**
   * Legacy session replay setup entrypoint. Prefer setup() for new native features.
   */
  start: (
    sessionId: string,
    sdkOptions: PostHogReactNativePluginMap,
    sdkReplayConfig: PostHogReactNativePluginMap,
    decideReplayConfig: PostHogReactNativePluginMap
  ) => Promise<void>

  startSession: (sessionId: string) => Promise<void>

  endSession: () => Promise<void>

  isEnabled: () => Promise<boolean>

  identify: (distinctId: string, anonymousId: string) => Promise<void>

  reset: (distinctId: string, anonymousId: string) => Promise<void>

  startRecording: (resumeCurrent: boolean) => Promise<void>

  stopRecording: () => Promise<void>

  addExceptionStep: (message: string, properties?: PostHogReactNativePluginMap) => Promise<void>

  registerPushNotificationToken: (deviceToken: string, appId: string | null) => Promise<void>

  unregisterPushNotificationToken: () => Promise<void>

  capturePushNotificationOpened: (properties: PostHogReactNativePluginMap) => Promise<void>

  setPushIdentityProvider: (provider: PostHogPushIdentityProvider) => void
}

const PostHogReactNativePlugin: PostHogReactNativePluginModule = {
  setup,
  start,
  startSession,
  endSession,
  isEnabled,
  identify,
  reset,
  startRecording,
  stopRecording,
  addExceptionStep,
  registerPushNotificationToken,
  unregisterPushNotificationToken,
  capturePushNotificationOpened,
  setPushIdentityProvider,
}

export default PostHogReactNativePlugin
