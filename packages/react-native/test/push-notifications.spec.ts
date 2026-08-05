import { PostHog } from '../src/posthog-rn'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { setupFetch, waitForExpect, waitForNativePluginEvaluation } from './test-utils'

jest.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePlugin: {
    start: jest.fn(() => Promise.resolve()),
    setup: jest.fn(() => Promise.resolve()),
    startSession: jest.fn(() => Promise.resolve()),
    endSession: jest.fn(() => Promise.resolve()),
    isEnabled: jest.fn(() => Promise.resolve(false)),
    identify: jest.fn(() => Promise.resolve()),
    startRecording: jest.fn(() => Promise.resolve()),
    stopRecording: jest.fn(() => Promise.resolve()),
    addExceptionStep: jest.fn(() => Promise.resolve()),
    registerPushNotificationToken: jest.fn(() => Promise.resolve()),
    unregisterPushNotificationToken: jest.fn(() => Promise.resolve()),
    setOptOut: jest.fn(() => Promise.resolve()),
    capturePushNotificationOpened: jest.fn(() => Promise.resolve()),
    setPushIdentityProvider: jest.fn(),
    reset: jest.fn(() => Promise.resolve()),
  },
}))

// Read lazily off globalThis: the mock factory's functions run while modules are still
// importing, before this file's const bindings initialize.
const mockPlatform = ((globalThis as any).__pushTestPlatform = { macos: false, web: false })
jest.mock('../src/utils', () => ({
  ...jest.requireActual('../src/utils'),
  isMacOS: () => (globalThis as any).__pushTestPlatform?.macos ?? false,
  isWeb: () => (globalThis as any).__pushTestPlatform?.web ?? false,
}))

jest.useRealTimers()

const mockPlugin = OptionalReactNativePlugin as unknown as { [key: string]: jest.Mock }

const createPostHog = async (options?: { [key: string]: any }): Promise<PostHog> => {
  const posthog = new PostHog('test-token', { persistence: 'memory', flushInterval: 0, ...options })
  await posthog.ready()
  await waitForNativePluginEvaluation(posthog)
  return posthog
}

// Holds native setup() in flight so tests can race calls against it.
const createPostHogWithPendingSetup = async (): Promise<{ posthog: PostHog; resolveSetup: () => void }> => {
  let resolveSetup: () => void = () => {}
  mockPlugin.setup.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveSetup = resolve)))
  const posthog = new PostHog('test-token', { persistence: 'memory', flushInterval: 0 })
  await posthog.ready()
  await waitForExpect(1000, () => {
    expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
  })
  return { posthog, resolveSetup: () => resolveSetup() }
}

describe('push notifications', () => {
  const pluginMethods = { ...mockPlugin }

  beforeEach(() => {
    // Restore any method deleted by an outdated-plugin test before clearing call state.
    Object.assign(mockPlugin, pluginMethods)
    jest.clearAllMocks()
    mockPlugin.isEnabled.mockImplementation(() => Promise.resolve(false))
    mockPlatform.macos = false
    mockPlatform.web = false
    setupFetch()
  })

  describe('native plugin initialization', () => {
    it('initializes the native plugin by default with both capture flags on', async () => {
      const posthog = await createPostHog()

      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
      const pluginConfig = mockPlugin.setup.mock.calls[0][2]
      expect(pluginConfig.push).toEqual({
        capturePushNotificationSubscriptions: true,
        capturePushNotificationOpened: true,
        pushIdentityProviderEnabled: false,
      })
      expect(mockPlugin.setPushIdentityProvider).not.toHaveBeenCalled()

      await posthog.shutdown()
    })

    it('forwards explicit opt-outs so they reach the native defaults', async () => {
      const posthog = await createPostHog({
        capturePushNotificationSubscriptions: false,
        enableSessionReplay: true,
      })

      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
      expect(mockPlugin.setup.mock.calls[0][2].push).toEqual({
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: true,
        pushIdentityProviderEnabled: false,
      })

      await posthog.shutdown()
    })

    it('does not initialize the native plugin when everything push-related is off', async () => {
      const posthog = await createPostHog({
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
      })

      expect(mockPlugin.setup).not.toHaveBeenCalled()
      expect(mockPlugin.start).not.toHaveBeenCalled()

      await posthog.shutdown()
    })

    it('does not initialize native or register a token for an opted-out user', async () => {
      const posthog = await createPostHog({ defaultOptIn: false })

      expect(posthog.optedOut).toBe(true)
      expect(mockPlugin.setup).not.toHaveBeenCalled()

      await posthog.shutdown()
    })

    it('tells native the opt-out state so it cannot register on its own', async () => {
      const posthog = await createPostHog()

      const sdkOptions = mockPlugin.setup.mock.calls[0][1]
      expect(sdkOptions.optOut).toBe(false)

      await posthog.shutdown()
    })

    it('skips the native feature-flag preload when push is the only reason to init', async () => {
      const posthog = await createPostHog()

      // JS already owns flags; a push-only native SDK must not duplicate the fetch.
      const sdkOptions = mockPlugin.setup.mock.calls[0][1]
      expect(sdkOptions.preloadFeatureFlags).toBe(false)

      await posthog.shutdown()
    })

    it('keeps the native flags fetch when error tracking also needs it', async () => {
      // Native error tracking's autocapture kill-switch reads the remote config it loads.
      const posthog = await createPostHog({
        errorTracking: { autocapture: { nativeCrashes: true } },
      })

      const sdkOptions = mockPlugin.setup.mock.calls[0][1]
      expect(sdkOptions.preloadFeatureFlags).toBe(true)

      await posthog.shutdown()
    })

    it('resets native on reset() so the logged-out push subscription is unregistered', async () => {
      const posthog = await createPostHog()
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)

      posthog.reset()

      // identify() only writes native preferences; reset() is what moves the subscription.
      await waitForExpect(1000, () => {
        expect(mockPlugin.reset).toHaveBeenCalledTimes(1)
      })

      await posthog.shutdown()
    })

    it('queues reset() behind an in-flight native setup instead of dropping it', async () => {
      const { posthog, resolveSetup } = await createPostHogWithPendingSetup()

      // A reset fired while setup() is still in flight must reach native once it completes,
      // or push stays bound to the stale pre-reset identity.
      posthog.reset()
      expect(mockPlugin.reset).not.toHaveBeenCalled()

      resolveSetup()
      await waitForExpect(1000, () => {
        expect(mockPlugin.reset).toHaveBeenCalledTimes(1)
      })

      await posthog.shutdown()
    })

    it('re-sends consent on reset(), which clears the JS opt-out', async () => {
      // super.reset() drops the persisted OptedOut property, so JS is opted back in. Native
      // keeps its own copy and would otherwise stay opted out for the rest of the process,
      // silently suppressing push, replay and crash uploads for the new user.
      const posthog = await createPostHog()
      await posthog.optOut()
      await waitForExpect(1000, () => {
        expect(mockPlugin.setOptOut).toHaveBeenCalledWith(true)
      })
      mockPlugin.setOptOut.mockClear()

      posthog.reset()

      await waitForExpect(1000, () => {
        expect(mockPlugin.setOptOut).toHaveBeenCalledWith(false)
      })

      await posthog.shutdown()
    })

    it('orders a native reset() before an identify() issued after it', async () => {
      // reset() then identify() is the ordinary logout-then-login sequence. Both share one
      // native command queue, so the reset lands first and the identity write reads the
      // identified id at dispatch — a snapshot taken before identify() would strand native
      // on the throwaway post-reset anonymous id.
      const posthog = await createPostHog()

      posthog.reset()
      await posthog.identify('user-B')

      await waitForExpect(1000, () => {
        expect(mockPlugin.reset).toHaveBeenCalledTimes(1)
        expect(mockPlugin.identify).toHaveBeenCalled()
      })
      expect(mockPlugin.reset.mock.invocationCallOrder[0]).toBeLessThan(mockPlugin.identify.mock.invocationCallOrder[0])
      expect(mockPlugin.identify).toHaveBeenLastCalledWith('user-B', expect.any(String))

      await posthog.shutdown()
    })

    it('initializes native push on optIn() when the app started opted out', async () => {
      // Nothing runs setup() for an opted-out user, and optIn() alone used to propagate
      // consent to a native instance that did not exist — so push never armed without a
      // restart, contradicting the changeset's no-restart promise.
      const posthog = await createPostHog({ defaultOptIn: false })
      expect(mockPlugin.setup).not.toHaveBeenCalled()

      await posthog.optIn()

      await waitForExpect(1000, () => {
        expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
      })
      expect(mockPlugin.setup.mock.calls[0][1].optOut).toBe(false)

      await posthog.shutdown()
    })

    it('converges on the final consent when optOut() and optIn() are not awaited', async () => {
      // optOut() dispatches two bridge calls where optIn() dispatches one, so an unawaited
      // pair could previously land setOptOut(false) before setOptOut(true) and leave native
      // stuck opted out until the next cold start.
      const posthog = await createPostHog()

      void posthog.optOut()
      void posthog.optIn()

      await waitForExpect(1000, () => {
        expect(mockPlugin.setOptOut).toHaveBeenCalled()
        const calls = mockPlugin.setOptOut.mock.calls
        expect(calls[calls.length - 1][0]).toBe(false)
      })
      expect(posthog.optedOut).toBe(false)

      await posthog.shutdown()
    })

    it('installs the JS identity provider before setup and flags it in the config', async () => {
      const provider = jest.fn(async () => 'token')
      const posthog = await createPostHog({ pushIdentityProvider: provider })

      expect(mockPlugin.setPushIdentityProvider).toHaveBeenCalledWith(provider)
      expect(mockPlugin.setup.mock.calls[0][2].push.pushIdentityProviderEnabled).toBe(true)
      expect(mockPlugin.setPushIdentityProvider.mock.invocationCallOrder[0]).toBeLessThan(
        mockPlugin.setup.mock.invocationCallOrder[0]
      )

      await posthog.shutdown()
    })

    it('keeps the provider marker off when the installed plugin predates it', async () => {
      delete (mockPlugin as any).setPushIdentityProvider

      const posthog = await createPostHog({ pushIdentityProvider: jest.fn(async () => 'token') })

      expect(mockPlugin.setup.mock.calls[0][2].push.pushIdentityProviderEnabled).toBe(false)

      await posthog.shutdown()
    })

    it('a provider alone forces native initialization even with capture flags off', async () => {
      const posthog = await createPostHog({
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        pushIdentityProvider: jest.fn(async () => null),
      })

      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)

      await posthog.shutdown()
    })
  })

  describe('registerPushNotificationToken', () => {
    it('passes deviceToken and appId', async () => {
      const posthog = await createPostHog()

      await posthog.registerPushNotificationToken('a-token', { appId: 'my-project' })

      expect(mockPlugin.registerPushNotificationToken).toHaveBeenCalledWith('a-token', 'my-project')

      await posthog.shutdown()
    })

    it('passes a null appId when omitted, so native resolves its own fallback', async () => {
      const posthog = await createPostHog()

      await posthog.registerPushNotificationToken('a-token')

      expect(mockPlugin.registerPushNotificationToken).toHaveBeenCalledWith('a-token', null)

      await posthog.shutdown()
    })

    it('swallows a native rejection instead of throwing', async () => {
      const posthog = await createPostHog()
      mockPlugin.registerPushNotificationToken.mockImplementationOnce(() => Promise.reject(new Error('no appId')))

      await expect(posthog.registerPushNotificationToken('a-token')).resolves.toBeUndefined()

      await posthog.shutdown()
    })

    it('no-ops on macOS', async () => {
      const posthog = await createPostHog()
      mockPlatform.macos = true

      await posthog.registerPushNotificationToken('a-token')

      expect(mockPlugin.registerPushNotificationToken).not.toHaveBeenCalled()

      await posthog.shutdown()
    })

    it('no-ops for an opted-out user', async () => {
      const posthog = await createPostHog()
      await posthog.optOut()

      await posthog.registerPushNotificationToken('a-token')

      expect(mockPlugin.registerPushNotificationToken).not.toHaveBeenCalled()

      await posthog.shutdown()
    })

    it('unregisters the existing subscription on opt-out', async () => {
      // Native keeps its own persisted record and retry loop and never sees the JS opt-out, so a
      // token registered before consent withdrawal would stay live unless opt-out removes it.
      const posthog = await createPostHog()

      await posthog.optOut()

      await waitForExpect(1000, () => {
        expect(mockPlugin.unregisterPushNotificationToken).toHaveBeenCalledTimes(1)
      })

      await posthog.shutdown()
    })

    it('propagates opt-out to native after the unregister is dispatched', async () => {
      // Native persists its own consent flag and only reads the JS one at setup(), so without
      // this an OS token refresh after optOut() would auto-register a new subscription. The
      // unregister must be dispatched first: native gates unregister sends on its opt-out flag.
      const posthog = await createPostHog()

      await posthog.optOut()

      await waitForExpect(1000, () => {
        expect(mockPlugin.setOptOut).toHaveBeenCalledWith(true)
      })
      expect(mockPlugin.unregisterPushNotificationToken.mock.invocationCallOrder[0]).toBeLessThan(
        mockPlugin.setOptOut.mock.invocationCallOrder[0]
      )

      await posthog.shutdown()
    })

    it('propagates opt-in to native so push re-arms without a restart', async () => {
      const posthog = await createPostHog()
      await posthog.optOut()
      await waitForExpect(1000, () => {
        expect(mockPlugin.setOptOut).toHaveBeenCalledWith(true)
      })

      await posthog.optIn()

      await waitForExpect(1000, () => {
        expect(mockPlugin.setOptOut).toHaveBeenCalledWith(false)
      })

      await posthog.shutdown()
    })

    it('skips consent propagation when the installed plugin predates setOptOut', async () => {
      const posthog = await createPostHog()
      delete (mockPlugin as any).setOptOut

      await posthog.optOut()
      await posthog.optIn()

      await posthog.shutdown()
    })

    it('blocks a queued register when consent is withdrawn while native setup is in flight', async () => {
      const { posthog, resolveSetup } = await createPostHogWithPendingSetup()

      // The consent check runs before the init await; withdrawing consent in that window must
      // not let the queued call register after opt-out.
      const registerPromise = posthog.registerPushNotificationToken('a-token')
      await posthog.optOut()

      resolveSetup()
      await registerPromise

      expect(mockPlugin.registerPushNotificationToken).not.toHaveBeenCalled()

      await posthog.shutdown()
    })

    it('still allows unregistering explicitly after opt-out', async () => {
      // Unregistering removes data, so it stays callable while opted out.
      const posthog = await createPostHog()
      await posthog.optOut()
      await waitForExpect(1000, () => {
        expect(mockPlugin.unregisterPushNotificationToken).toHaveBeenCalled()
      })
      mockPlugin.unregisterPushNotificationToken.mockClear()

      await posthog.unregisterPushNotificationToken()

      expect(mockPlugin.unregisterPushNotificationToken).toHaveBeenCalledTimes(1)

      await posthog.shutdown()
    })

    it('brings native up for a manual register when both capture flags are off', async () => {
      // The FCM-on-both-platforms setup the docs describe: auto-capture off, host registers
      // itself. Without a forced init the promise resolves having done nothing, because
      // native's own isEnabled() guard drops the call when setup() never ran.
      const posthog = await createPostHog({
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
      })
      expect(mockPlugin.setup).not.toHaveBeenCalled()

      await posthog.registerPushNotificationToken('a-token')

      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
      // Forcing init must not turn auto-capture back on: the config still carries the opt-out.
      expect(mockPlugin.setup.mock.calls[0][2].push).toEqual({
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        pushIdentityProviderEnabled: false,
      })
      expect(mockPlugin.registerPushNotificationToken).toHaveBeenCalledWith('a-token', null)

      await posthog.shutdown()
    })

    it('does not claim native initialization on the legacy session-replay plugin', async () => {
      // The legacy plugin has no setup(), so push can never reach native. Latching that as
      // "unsupported" rather than "initialized" keeps a manual call from being reported as
      // delivered — and keeps session replay's own resume path from trusting a dead instance.
      delete (mockPlugin as any).setup
      const posthog = await createPostHog()

      await posthog.registerPushNotificationToken('a-token')

      expect(mockPlugin.registerPushNotificationToken).not.toHaveBeenCalled()

      await posthog.shutdown()
    })

    it('no-ops without throwing when the installed plugin predates push', async () => {
      const posthog = await createPostHog()
      delete (mockPlugin as any).registerPushNotificationToken

      await expect(posthog.registerPushNotificationToken('a-token')).resolves.toBeUndefined()

      await posthog.shutdown()
    })
  })

  describe('unregisterPushNotificationToken', () => {
    it('reaches the plugin', async () => {
      const posthog = await createPostHog()

      await posthog.unregisterPushNotificationToken()

      expect(mockPlugin.unregisterPushNotificationToken).toHaveBeenCalledTimes(1)

      await posthog.shutdown()
    })

    it('no-ops on macOS', async () => {
      const posthog = await createPostHog()
      mockPlatform.macos = true

      await posthog.unregisterPushNotificationToken()

      expect(mockPlugin.unregisterPushNotificationToken).not.toHaveBeenCalled()

      await posthog.shutdown()
    })
  })

  describe('capturePushNotificationOpened', () => {
    it('passes every field', async () => {
      const posthog = await createPostHog()

      await posthog.capturePushNotificationOpened({
        title: 'a title',
        subtitle: 'a subtitle',
        body: 'a body',
        payload: { posthog: { campaign: 'welcome' } },
        action: 'reply',
      })

      expect(mockPlugin.capturePushNotificationOpened).toHaveBeenCalledWith({
        title: 'a title',
        subtitle: 'a subtitle',
        body: 'a body',
        payload: { posthog: { campaign: 'welcome' } },
        action: 'reply',
      })

      await posthog.shutdown()
    })

    it('omits undefined fields but preserves empty strings', async () => {
      const posthog = await createPostHog()

      await posthog.capturePushNotificationOpened({ title: '' })

      expect(mockPlugin.capturePushNotificationOpened).toHaveBeenCalledWith({ title: '' })

      await posthog.shutdown()
    })

    it('is allowed on macOS, unlike register/unregister', async () => {
      const posthog = await createPostHog()
      mockPlatform.macos = true

      await posthog.capturePushNotificationOpened({ title: 'a title' })

      expect(mockPlugin.capturePushNotificationOpened).toHaveBeenCalledWith({ title: 'a title' })

      await posthog.shutdown()
    })

    it('no-ops on web', async () => {
      const posthog = await createPostHog()
      mockPlatform.web = true

      await posthog.capturePushNotificationOpened({ title: 'a title' })

      expect(mockPlugin.capturePushNotificationOpened).not.toHaveBeenCalled()

      await posthog.shutdown()
    })
  })
})
