/* eslint-disable compat/compat */
// All mock state lives inside the factory: the mocked module is required while this
// file's imports hoist, before any module-scope const here would initialize.
jest.mock('react-native', () => {
  const listeners: { [event: string]: (payload: any) => void | Promise<void> } = {}
  const removed: string[] = []
  const nativeModule = {
    providePushIdentityToken: jest.fn(() => Promise.resolve()),
  }
  return {
    __pushMock: { listeners, removed, nativeModule },
    NativeModules: { PosthogReactNativePlugin: nativeModule },
    NativeEventEmitter: class {
      addListener(event: string, handler: (payload: any) => void) {
        listeners[event] = handler
        return {
          remove: () => {
            removed.push(event)
            delete listeners[event]
          },
        }
      }
    },
    Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
  }
})

import { setPushIdentityProvider } from '../index'

const { listeners, removed, nativeModule } = (jest.requireMock('react-native') as any).__pushMock as {
  listeners: { [event: string]: (payload: any) => void | Promise<void> }
  removed: string[]
  nativeModule: { providePushIdentityToken: jest.Mock }
}

const emitRequest = async (requestId = 'req-1'): Promise<void> => {
  const handler = listeners.PostHogPushIdentityRequest
  if (!handler) {
    throw new Error('no PostHogPushIdentityRequest listener installed')
  }
  await handler({ requestId, distinctId: 'user-1', appId: 'my-project' })
  // providePushIdentityToken is awaited inside the handler; flush the microtask queue.
  await Promise.resolve()
}

describe('setPushIdentityProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    nativeModule.providePushIdentityToken.mockImplementation(() => Promise.resolve())
    removed.length = 0
  })

  it('replies with the minted token, keyed by request id', async () => {
    const provider = jest.fn(async (distinctId: string, appId: string) => `token-${distinctId}-${appId}`)
    setPushIdentityProvider(provider)

    await emitRequest()

    expect(provider).toHaveBeenCalledWith('user-1', 'my-project')
    expect(nativeModule.providePushIdentityToken).toHaveBeenCalledWith('req-1', 'token-user-1-my-project')
  })

  it('a throwing provider degrades to a null token', async () => {
    setPushIdentityProvider(jest.fn(async () => Promise.reject(new Error('mint failed'))))

    await emitRequest()

    expect(nativeModule.providePushIdentityToken).toHaveBeenCalledWith('req-1', null)
  })

  it('a non-string reply degrades to a null token', async () => {
    setPushIdentityProvider(jest.fn(async () => 42 as any))

    await emitRequest()

    expect(nativeModule.providePushIdentityToken).toHaveBeenCalledWith('req-1', null)
  })

  it('installing a new provider replaces the previous listener', async () => {
    setPushIdentityProvider(jest.fn(async () => 'old'))
    // The module-level subscription persists across tests; only count removals
    // caused by the replacement below.
    removed.length = 0
    const replacement = jest.fn(async () => 'new')
    setPushIdentityProvider(replacement)

    await emitRequest()

    expect(removed).toEqual(['PostHogPushIdentityRequest'])
    expect(replacement).toHaveBeenCalled()
    expect(nativeModule.providePushIdentityToken).toHaveBeenCalledWith('req-1', 'new')
  })

  it('a failing native reply does not throw into the emitter', async () => {
    nativeModule.providePushIdentityToken.mockImplementation(() => Promise.reject(new Error('bridge gone')))
    setPushIdentityProvider(jest.fn(async () => 'token'))

    await expect(emitRequest()).resolves.toBeUndefined()
  })
})
