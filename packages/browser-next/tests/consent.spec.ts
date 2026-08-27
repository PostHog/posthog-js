import type { Client, Disposable, Extension } from '@posthog/browser-common'

import { analytics as createAnalytics } from '../src/analytics'
import {
    createPostHog,
    type BrowserFetch,
    type RemoteConfig,
    type SendRequestInit,
    type StorageLike,
} from '../src/core'
import { createFetch, MemoryStorage, type SentRequest } from './helpers'

const analytics = () => createAnalytics({ flushAt: 1, flushInterval: 0 })
const bufferedAnalytics = () => createAnalytics({ flushAt: 100, flushInterval: 0 })
const DEFAULT_KEY = '__ph_opt_in_out_ph_test'

class ObservableStorage extends MemoryStorage {
    readonly listeners = new Map<string, Set<() => void>>()
    disposed = 0

    subscribe(key: string, listener: () => void): Disposable {
        const listeners = this.listeners.get(key) ?? new Set()
        listeners.add(listener)
        this.listeners.set(key, listeners)
        return {
            dispose: () => {
                listeners.delete(listener)
                this.disposed++
            },
        }
    }

    externalSet(key: string, value: string | null): void {
        if (value === null) {
            this.values.delete(key)
        } else {
            this.values.set(key, value)
        }
        this.listeners.get(key)?.forEach((listener) => listener())
    }
}

const dispatchStorage = (
    key: string | null,
    storageArea: StorageLike | null,
    newValue = key === null ? null : (storageArea?.getItem(key) ?? null)
): void => {
    const event = new Event('storage')
    Object.defineProperties(event, {
        key: { value: key },
        newValue: { value: newValue },
        storageArea: { value: storageArea },
    })
    globalThis.dispatchEvent(event)
}

const setDefaultStorage = (storage: StorageLike): void => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
}

const dispatchConsentChange = (key = DEFAULT_KEY): void => {
    globalThis.dispatchEvent(new CustomEvent('__posthog_browser_consent_change__', { detail: key }))
}

describe('portable consent persistence', () => {
    const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()

    beforeEach(() => {
        const target = new EventTarget()
        for (const [key, value] of [
            ['addEventListener', target.addEventListener.bind(target)],
            ['removeEventListener', target.removeEventListener.bind(target)],
            ['dispatchEvent', target.dispatchEvent.bind(target)],
        ] as const) {
            descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
            Object.defineProperty(globalThis, key, { configurable: true, value, writable: true })
        }
        descriptors.set('CustomEvent', Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent'))
        descriptors.set('localStorage', Object.getOwnPropertyDescriptor(globalThis, 'localStorage'))
        class TestCustomEvent<T> extends Event {
            readonly detail: T
            constructor(type: string, init: CustomEventInit<T>) {
                super(type)
                this.detail = init.detail as T
            }
        }
        Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: TestCustomEvent, writable: true })
    })

    afterEach(() => {
        jest.restoreAllMocks()
        for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent', 'CustomEvent', 'localStorage']) {
            const descriptor = descriptors.get(key)
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor)
            } else {
                delete (globalThis as Record<string, unknown>)[key]
            }
        }
        descriptors.clear()
        jest.useRealTimers()
    })
    it.each([
        ['default Unicode token', 'ph_🦔', undefined, undefined, '__ph_opt_in_out_ph_🦔'],
        ['custom name', 'ph_test', 'shared-consent', undefined, 'shared-consent'],
        ['empty custom name', 'ph_test', '', undefined, ''],
        ['persistence key independence', 'ph_test', undefined, 'custom-state', DEFAULT_KEY],
    ])('uses the %s key verbatim', async (_name, projectToken, consentPersistenceName, persistenceKey, expectedKey) => {
        const storage = new MemoryStorage()
        const posthog = await createPostHog({
            projectToken,
            storage,
            navigator: false,
            fetch: false,
            ...(consentPersistenceName === undefined ? {} : { consentPersistenceName }),
            ...(persistenceKey === undefined ? {} : { persistenceKey }),
        })

        expect(storage.values.has(expectedKey)).toBe(false)
        posthog.optOut()
        expect(storage.values.get(expectedKey)).toBe('0')
    })

    it.each([
        [true, false],
        ['1', false],
        [1, false],
        [' true ', false],
        ['YES', false],
        [false, true],
        ['0', true],
        [0, true],
        [' false ', true],
        ['NO', true],
    ])('reads interoperable value %j', async (value, denied) => {
        const storage = new MemoryStorage()
        ;(storage.values as unknown as Map<string, unknown>).set(DEFAULT_KEY, value)

        const posthog = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        expect(posthog.hasOptedOut()).toBe(denied)
        expect(storage.values.get(DEFAULT_KEY)).toBe(value)
    })

    it.each([undefined, '', 'maybe', '2', 'null'])('treats %j as no explicit decision', async (value) => {
        const storage = new MemoryStorage()
        if (value !== undefined) {
            storage.setItem(DEFAULT_KEY, value)
        }
        const implicit = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        expect(implicit.hasOptedOut()).toBe(false)
        expect(storage.values.get(DEFAULT_KEY)).toBe(value)

        const deniedStorage = new MemoryStorage()
        if (value !== undefined) {
            deniedStorage.setItem(DEFAULT_KEY, value)
        }
        const denied = await createPostHog({
            projectToken: 'ph_test',
            storage: deniedStorage,
            navigator: false,
            fetch: false,
            optOutByDefault: true,
        })
        expect(denied.hasOptedOut()).toBe(true)
        expect(deniedStorage.values.get(DEFAULT_KEY)).toBe(value)
    })

    it('writes only raw 0 and 1 for explicit decisions', async () => {
        const storage = new MemoryStorage()
        const posthog = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        posthog.optIn()
        expect(storage.values.get(DEFAULT_KEY)).toBe('1')
        posthog.optOut()
        expect(storage.values.get(DEFAULT_KEY)).toBe('0')
    })

    it('keeps extension state and persistence available under prior denial while blocking transmission', async () => {
        const extensionSetup = jest.fn(async (client: Client) => {
            client.kv.set('private', true)
            await client.capture('extension-blocked')
            await client.sendRequest('/flags/')
        })
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
        const storage = new MemoryStorage()
        storage.values.set(DEFAULT_KEY, '0')

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch,
            extensions: [{ name: 'blocked-by-consent', setup: extensionSetup }],
        })
        await posthog.capture('blocked')
        await posthog.sendRequest('/flags/')

        expect(extensionSetup).toHaveBeenCalledTimes(1)
        expect(posthog.getExtension('blocked-by-consent')).toBeDefined()
        expect(fetch).not.toHaveBeenCalled()
        expect(posthog.anonymousId).not.toBe('')
        expect(posthog.session.sessionId).toBe('')
        expect(storage.values.has('ph_ph_test_posthog_browser_v2')).toBe(true)
    })

    it('contains storage read, write, remove, subscribe, and cleanup failures', async () => {
        const storage: StorageLike = {
            getItem() {
                throw new Error('read failed')
            },
            setItem() {
                throw new Error('write failed')
            },
            removeItem() {
                throw new Error('remove failed')
            },
            subscribe() {
                throw new Error('subscribe failed')
            },
        }
        const posthog = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        expect(() => posthog.optOut()).not.toThrow()
        expect(posthog.hasOptedOut()).toBe(true)
        expect(() => posthog.optIn()).not.toThrow()
        expect(posthog.hasOptedOut()).toBe(false)
        await expect(posthog.dispose()).resolves.toBeUndefined()

        const cleanupStorage = new MemoryStorage() as StorageLike
        cleanupStorage.subscribe = () => ({
            dispose() {
                throw new Error('cleanup failed')
            },
        })
        const cleanup = await createPostHog({
            projectToken: 'ph_test',
            storage: cleanupStorage,
            navigator: false,
            fetch: false,
        })
        await expect(cleanup.dispose()).resolves.toBeUndefined()
    })

    it('retains a local explicit decision after its durable write fails until storage changes', async () => {
        const storage = new MemoryStorage() as MemoryStorage & { failWrites: boolean }
        storage.failWrites = false
        const originalSet = storage.setItem.bind(storage)
        storage.setItem = (key, value) => {
            if (storage.failWrites) {
                throw new Error('write failed')
            }
            originalSet(key, value)
        }
        storage.setItem(DEFAULT_KEY, '1')
        const posthog = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        storage.failWrites = true
        posthog.optOut()
        expect(posthog.hasOptedOut()).toBe(true)
        expect(storage.values.get(DEFAULT_KEY)).toBe('1')

        storage.values.set(DEFAULT_KEY, '0')
        expect(posthog.hasOptedOut()).toBe(true)
        storage.values.set(DEFAULT_KEY, 'yes')
        expect(posthog.hasOptedOut()).toBe(false)
    })

    it('keeps a failed local decision across duplicate notifications until storage changes', async () => {
        const storage = new ObservableStorage() as ObservableStorage & { failWrites: boolean }
        storage.failWrites = false
        const originalSet = storage.setItem.bind(storage)
        storage.setItem = (key, value) => {
            if (storage.failWrites) {
                throw new Error('write failed')
            }
            originalSet(key, value)
        }
        storage.setItem(DEFAULT_KEY, '1')
        const posthog = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const distinctId = posthog.distinctId

        storage.failWrites = true
        posthog.optOut()
        storage.externalSet(DEFAULT_KEY, '1')
        dispatchConsentChange()
        expect(posthog.hasOptedOut()).toBe(true)
        expect(posthog.distinctId).toBe(distinctId)

        storage.externalSet(DEFAULT_KEY, 'yes')
        expect(posthog.hasOptedOut()).toBe(false)
    })

    it('does not read the former state-derived consent key', async () => {
        const storage = new MemoryStorage()
        storage.setItem('ph_ph_test_posthog_browser_v2_consent', '0')

        const posthog = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        expect(posthog.hasOptedOut()).toBe(false)
        expect(storage.values.has(DEFAULT_KEY)).toBe(false)
    })

    it('purges sibling queued work and never revives it after a later grant', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [bufferedAnalytics()],
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        await first.capture('private-before-denial')

        second.optOut()
        second.optIn()
        await first.flush()

        expect(requests).toHaveLength(0)
    })

    it('retains sibling identity, session, and KV state across denial and grant', async () => {
        const storage = new MemoryStorage()
        const first = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        await first.identify('person-before-denial')
        first.kv.set('private', { value: true })
        const oldAnonymousId = first.anonymousId
        const oldSessionId = first.session.sessionId

        second.optOut()
        expect(first.hasOptedOut()).toBe(true)
        expect(first.anonymousId).toBe(oldAnonymousId)
        expect(first.session.sessionId).toBe(oldSessionId)
        expect(first.kv.get('private')).toEqual({ value: true })

        second.optIn()
        expect(first.hasOptedOut()).toBe(false)
        expect(first.anonymousId).toBe(oldAnonymousId)
        expect(first.session.sessionId).toBe(oldSessionId)
        expect(first.kv.get('private')).toEqual({ value: true })
    })

    it('cancels a sibling retry backoff even when consent is granted again', async () => {
        jest.useFakeTimers()
        try {
            const storage = new MemoryStorage()
            const fetch = jest
                .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
                .mockResolvedValue(new Response('{}', { status: 503 }))
            const first = await createPostHog({
                projectToken: 'ph_test',
                storage,
                navigator: false,
                fetch,
                extensions: [analytics()],
            })
            const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
            await first.capture('retrying')
            await jest.advanceTimersByTimeAsync(0)
            expect(fetch).toHaveBeenCalledTimes(1)

            second.optOut()
            second.optIn()
            await first.flush()

            expect(fetch).toHaveBeenCalledTimes(1)
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('ignores native storage events for another key or storage area', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        setDefaultStorage(storage)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            navigator: false,
            fetch: createFetch(requests),
            extensions: [bufferedAnalytics()],
        })
        await posthog.capture('retained')

        storage.values.set(DEFAULT_KEY, '0')
        dispatchStorage('unrelated', storage)
        dispatchStorage(DEFAULT_KEY, new MemoryStorage())
        storage.values.set(DEFAULT_KEY, '1')
        dispatchStorage(DEFAULT_KEY, storage)
        await posthog.flush()
        expect(requests).toHaveLength(1)
    })

    it('observes native storage denial from the event value', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        setDefaultStorage(storage)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            navigator: false,
            fetch: createFetch(requests),
            extensions: [bufferedAnalytics()],
        })
        await posthog.capture('private')

        storage.values.set(DEFAULT_KEY, '0')
        dispatchStorage(DEFAULT_KEY, storage)
        storage.values.set(DEFAULT_KEY, '1')
        dispatchStorage(DEFAULT_KEY, storage)
        await posthog.flush()
        expect(requests).toHaveLength(0)
    })

    it('does not miss a native denial when storage is already granted again', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        setDefaultStorage(storage)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            navigator: false,
            fetch: createFetch(requests),
            extensions: [bufferedAnalytics()],
        })
        await posthog.capture('private')

        storage.values.set(DEFAULT_KEY, '1')
        dispatchStorage(DEFAULT_KEY, storage, '0')
        dispatchStorage(DEFAULT_KEY, storage, '1')
        await posthog.flush()
        expect(requests).toHaveLength(0)
    })

    it('never treats native storage events as custom-adapter notifications', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [bufferedAnalytics()],
        })
        await posthog.capture('retained')

        storage.values.set(DEFAULT_KEY, '0')
        dispatchStorage(DEFAULT_KEY, storage)
        storage.values.set(DEFAULT_KEY, '1')
        await posthog.flush()
        expect(requests).toHaveLength(1)
    })

    it('installs no observers when effective storage is absent', async () => {
        const add = jest.spyOn(globalThis, 'addEventListener')
        const noStorage = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })

        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get() {
                throw new Error('storage unavailable')
            },
        })
        const failedDefault = await createPostHog({ projectToken: 'ph_test', navigator: false, fetch: false })
        const botStorage = new ObservableStorage()
        const bot = await createPostHog({
            projectToken: 'ph_test',
            storage: botStorage,
            navigator: { webdriver: true },
            fetch: false,
        })

        expect(add).not.toHaveBeenCalled()
        expect(botStorage.listeners.size).toBe(0)
        await Promise.all([noStorage.dispose(), failedDefault.dispose(), bot.dispose()])
        add.mockRestore()
    })

    it('falls back to a fresh read when CustomEvent is unavailable', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [bufferedAnalytics()],
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        await first.capture('private')
        delete (globalThis as Record<string, unknown>).CustomEvent

        expect(() => second.optOut()).not.toThrow()
        expect(first.hasOptedOut()).toBe(true)
        second.optIn()
        await first.flush()
        expect(requests).toHaveLength(0)
    })

    it('observes adapter mutation promptly and plain adapters at the next gated operation', async () => {
        const observable = new ObservableStorage()
        const observableRequests: SentRequest[] = []
        const observed = await createPostHog({
            projectToken: 'ph_test',
            storage: observable,
            navigator: false,
            fetch: createFetch(observableRequests),
            extensions: [bufferedAnalytics()],
        })
        await observed.capture('observable-private')
        observable.externalSet(DEFAULT_KEY, '0')
        observable.externalSet(DEFAULT_KEY, '1')
        await observed.flush()
        expect(observableRequests).toHaveLength(0)

        const plain = new MemoryStorage()
        const plainRequests: SentRequest[] = []
        const nextGate = await createPostHog({
            projectToken: 'ph_test',
            storage: plain,
            navigator: false,
            fetch: createFetch(plainRequests),
            extensions: [bufferedAnalytics()],
        })
        await nextGate.capture('plain-private')
        plain.values.set(DEFAULT_KEY, '0')
        await expect(nextGate.sendRequest('/flags/')).resolves.toMatchObject({ statusCode: 0 })
        plain.values.set(DEFAULT_KEY, '1')
        await nextGate.flush()
        expect(plainRequests).toHaveLength(0)
    })

    it('retains public and extension identity state after observing external denial', async () => {
        const storage = new MemoryStorage()
        let extensionClient: Client | undefined
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            extensions: [{ name: 'getter-reader', setup: (client) => void (extensionClient = client) }],
        })
        await posthog.identify('private-person')
        await posthog.group('company', 'private-company')
        const anonymousId = posthog.anonymousId
        const deviceId = posthog.deviceId
        const groups = posthog.groups
        const session = posthog.session
        storage.values.set(DEFAULT_KEY, '0')

        expect(posthog.hasOptedOut()).toBe(true)
        expect(extensionClient?.distinctId).toBe('private-person')
        expect(extensionClient?.anonymousId).toBe(anonymousId)
        expect(extensionClient?.deviceId).toBe(deviceId)
        expect(extensionClient?.groups).toEqual(groups)
        expect(extensionClient?.session).toEqual(session)
        expect(posthog.distinctId).toBe('private-person')
        expect(posthog.anonymousId).toBe(anonymousId)
        expect(posthog.groups).toEqual(groups)
        expect(posthog.session).toEqual(session)
    })

    it('completes capture authorized before serialization crosses denial and grant', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const observed = jest.fn()
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [analytics()],
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        first.onEvent(observed)

        await first.capture('private', {
            value: {
                toJSON() {
                    second.optOut()
                    second.optIn()
                    return 'serialized'
                },
            },
        })
        await first.flush()

        expect(observed).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'private', properties: expect.objectContaining({ value: 'serialized' }) })
        )
        expect(requests).toHaveLength(1)
    })

    it('completes capture authorized before a dynamic producer crosses denial and grant', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const observed = jest.fn()
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [analytics()],
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        first.onEvent(observed)
        first.registerDynamicEventProperties(() => {
            second.optOut()
            second.optIn()
            return { private: true }
        })

        await first.capture('private')
        await first.flush()
        expect(observed).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'private', properties: expect.objectContaining({ private: true }) })
        )
        expect(requests).toHaveLength(1)
    })

    it('completes event fanout while denial from an observer purges queued delivery', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const laterObserver = jest.fn()
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            extensions: [analytics()],
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        first.onEvent(() => {
            second.optOut()
            second.optIn()
        })
        first.onEvent(laterObserver)

        await first.capture('private')
        await first.flush()
        expect(laterObserver).toHaveBeenCalledTimes(1)
        expect(requests).toHaveLength(0)
    })

    it('purges queued work when denial occurs during overflow reporting', async () => {
        const storage = new MemoryStorage()
        const requests: SentRequest[] = []
        const startedAt = Date.now()
        let captureTime = startedAt
        jest.spyOn(Date, 'now').mockImplementation(() => captureTime)
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: createFetch(requests),
            debug: true,
        })
        const second = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage,
            navigator: false,
            fetch: false,
        })
        for (let index = 0; index < 1_000; index++) {
            captureTime = startedAt + (index + 1) * 110
            await first.capture(`queued-${index}`)
        }
        const warn = jest.spyOn(console, 'warn').mockImplementationOnce(() => {
            second.optOut()
            second.optIn()
        })

        await first.capture('private-overflow')
        await first.flush()

        expect(warn).toHaveBeenCalled()
        expect(requests).toEqual([])
    })

    it('completes capture fanout while denial from a new-session observer purges queued delivery', async () => {
        jest.useFakeTimers()
        try {
            jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
            const storage = new MemoryStorage()
            const requests: SentRequest[] = []
            const observed = jest.fn()
            const laterSessionObserver = jest.fn()
            const first = await createPostHog({
                projectToken: 'ph_test',
                storage,
                navigator: false,
                fetch: createFetch(requests),
                extensions: [analytics()],
            })
            const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
            first.onEvent(observed)
            first.onNewSession(() => {
                second.optOut()
                second.optIn()
            })
            first.onNewSession(laterSessionObserver)
            await first.capture('baseline')
            await first.flush()
            observed.mockClear()
            requests.splice(0)
            jest.advanceTimersByTime(1_800_001)

            await first.capture('private')
            await first.flush()
            expect(laterSessionObserver).toHaveBeenCalledTimes(1)
            expect(observed).toHaveBeenCalledTimes(1)
            expect(requests).toHaveLength(0)
        } finally {
            jest.useRealTimers()
        }
    })

    it('publishes reset when its persistence write crosses denial and grant', async () => {
        const stateKey = 'ph_ph_test_posthog_browser_v2'
        const storage = new MemoryStorage() as MemoryStorage & { onStateWrite?: () => void }
        const originalSet = storage.setItem.bind(storage)
        storage.setItem = (key, value) => {
            originalSet(key, value)
            if (key === stateKey) {
                const callback = storage.onStateWrite
                delete storage.onStateWrite
                callback?.()
            }
        }
        const first = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const observed = jest.fn()
        first.onNewSession(observed)
        first.reset()
        storage.onStateWrite = () => {
            second.optOut()
            second.optIn()
        }

        await first.capture('after-reset')
        expect(observed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'reset' }))
    })

    it('keeps ownership of an extension whose asynchronous setup crosses denial and grant', async () => {
        const storage = new MemoryStorage()
        let finishSetup: (() => void) | undefined
        let markSetupStarted: (() => void) | undefined
        const setup = new Promise<void>((resolve) => {
            finishSetup = resolve
        })
        const setupStarted = new Promise<void>((resolve) => {
            markSetupStarted = resolve
        })
        const dispose = jest.fn()
        const extension: Extension = {
            name: 'late-consent',
            setup: () => {
                markSetupStarted?.()
                return setup
            },
            dispose,
        }
        const creatingFirst = createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            extensions: [extension],
        })
        await setupStarted
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        second.optOut()
        second.optIn()
        finishSetup?.()
        const first = await creatingFirst

        expect(dispose).not.toHaveBeenCalled()
        expect(first.getExtension('late-consent')).toBe(extension)
        await first.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)
    })

    it('invokes transport when consent is granted at dispatch after request preparation', async () => {
        const storage = new MemoryStorage()
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const first = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const init = Object.defineProperty({}, 'headers', {
            get() {
                second.optOut()
                second.optIn()
                return { 'X-Test': 'value' }
            },
        }) as SendRequestInit

        await expect(first.sendRequest('/flags/', init)).resolves.toMatchObject({ statusCode: 200 })
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ 'X-Test': 'value' })
    })

    it('does not invoke transport when request preparation ends with denied consent', async () => {
        const storage = new MemoryStorage()
        const fetch = jest
            .fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>()
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const first = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const init = Object.defineProperty({}, 'headers', {
            get() {
                second.optOut()
                return { 'X-Test': 'value' }
            },
        }) as SendRequestInit

        await expect(first.sendRequest('/flags/', init)).resolves.toMatchObject({ statusCode: 0 })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('returns a Fetch response received after denial and grant', async () => {
        const storage = new MemoryStorage()
        let finishFetch: ((response: Response) => void) | undefined
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>(
            () =>
                new Promise<Response>((resolve) => {
                    finishFetch = resolve
                })
        )
        const first = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        const response = first.sendRequest('/flags/')
        second.optOut()
        second.optIn()
        finishFetch?.(new Response('{}', { status: 200 }))

        await expect(response).resolves.toMatchObject({ statusCode: 200 })
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('returns a Fetch failure received after denial and grant', async () => {
        const storage = new MemoryStorage()
        let failFetch: ((error: Error) => void) | undefined
        const fetch = jest.fn<ReturnType<BrowserFetch>, Parameters<BrowserFetch>>(
            () =>
                new Promise<Response>((_resolve, reject) => {
                    failFetch = reject
                })
        )
        const first = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        const response = first.sendRequest('/flags/')
        second.optOut()
        second.optIn()
        failFetch?.(new Error('private transport failure'))

        await expect(response).resolves.toMatchObject({
            statusCode: 0,
            error: expect.objectContaining({ message: 'private transport failure' }),
        })
    })

    it('returns Beacon acceptance that crosses denial and grant', async () => {
        const storage = new MemoryStorage()
        let revoke = (): void => {}
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: {
                sendBeacon() {
                    revoke()
                    return true
                },
            },
            fetch: false,
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        revoke = () => {
            second.optOut()
            second.optIn()
        }

        await expect(
            first.sendRequest('/flags/', { body: {}, method: 'POST', transport: 'sendBeacon' })
        ).resolves.toMatchObject({ statusCode: 202 })
    })

    it('loads and publishes remote config while analytics consent is denied', async () => {
        const storage = new MemoryStorage()
        storage.setItem(DEFAULT_KEY, '0')
        const config = { supportedCompression: ['gzip-js'] } as RemoteConfig
        const loader = jest.fn(async () => config)
        const observed = jest.fn()
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            remoteConfigLoader: loader,
            extensions: [{ name: 'subscriber', setup: (client) => void client.onRemoteConfig(observed) }],
        })
        expect(first.hasOptedOut()).toBe(true)
        await first.getRemoteConfig()

        expect(loader).toHaveBeenCalledTimes(1)
        expect(observed).toHaveBeenCalledWith({ ok: true, config })
    })

    it('publishes cached remote config once for each subscription regardless of consent', async () => {
        const storage = new MemoryStorage()
        storage.setItem(DEFAULT_KEY, '0')
        const config = { supportedCompression: ['gzip-js'] } as RemoteConfig
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            remoteConfig: config,
        })
        const observer = jest.fn()
        const first = posthog.onRemoteConfig(observer)
        posthog.onRemoteConfig(observer)
        first.dispose()

        posthog.optIn()
        await Promise.resolve()

        expect(observer).toHaveBeenCalledTimes(2)
        expect(observer).toHaveBeenCalledWith({ ok: true, config })
    })

    it('retains remote config whose loader crosses denial and grant', async () => {
        const storage = new MemoryStorage()
        let finishLoad: ((config: RemoteConfig) => void) | undefined
        const loaded = new Promise<RemoteConfig>((resolve) => {
            finishLoad = resolve
        })
        const loader = jest.fn(() => loaded)
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            remoteConfigLoader: loader,
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const result = first.getRemoteConfig()
        await Promise.resolve()
        second.optOut()
        second.optIn()
        const config = {} as RemoteConfig
        finishLoad?.(config)

        await expect(result).resolves.toBe(config)
        await expect(first.getRemoteConfig()).resolves.toBe(config)
        expect(loader).toHaveBeenCalledTimes(1)
    })

    it('completes remote-config fanout after a listener crosses denial and grant', async () => {
        const storage = new MemoryStorage()
        const config = { supportedCompression: ['gzip-js'] } as RemoteConfig
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            remoteConfigLoader: async () => config,
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })
        const laterObserver = jest.fn()
        first.onRemoteConfig(() => {
            second.optOut()
            second.optIn()
        })
        first.onRemoteConfig(laterObserver)

        await first.getRemoteConfig()

        expect(laterObserver).toHaveBeenCalledWith({ ok: true, config })
    })

    it('starts a deferred remote-config loader across denial and grant', async () => {
        const storage = new MemoryStorage()
        const loader = jest.fn(async () => ({}) as RemoteConfig)
        const first = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            remoteConfigLoader: loader,
        })
        const second = await createPostHog({ projectToken: 'ph_test', storage, navigator: false, fetch: false })

        const result = first.getRemoteConfig()
        second.optOut()
        second.optIn()

        await expect(result).resolves.toEqual({})
        expect(loader).toHaveBeenCalledTimes(1)
    })

    it('contains browser listener registration and cleanup failures', async () => {
        Object.defineProperty(globalThis, 'addEventListener', {
            configurable: true,
            writable: true,
            value: () => {
                throw new Error('registration failed')
            },
        })
        Object.defineProperty(globalThis, 'removeEventListener', {
            configurable: true,
            writable: true,
            value: () => {
                throw new Error('cleanup failed')
            },
        })

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: new MemoryStorage(),
            navigator: false,
            fetch: false,
        })
        expect(() => posthog.optOut()).not.toThrow()
        await expect(posthog.dispose()).resolves.toBeUndefined()
    })

    it('removes observations before waiting for extension disposal', async () => {
        const storage = new ObservableStorage()
        const add = jest.spyOn(globalThis, 'addEventListener')
        const remove = jest.spyOn(globalThis, 'removeEventListener')
        let finishExtensionDisposal: (() => void) | undefined
        const extensionDisposal = new Promise<void>((resolve) => {
            finishExtensionDisposal = resolve
        })
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            extensions: [{ name: 'slow-disposal', setup() {}, dispose: () => extensionDisposal }],
        })
        const registered = add.mock.calls.filter(
            ([type]) => type === 'storage' || type === '__posthog_browser_consent_change__'
        )

        const disposal = posthog.dispose()

        expect(registered).toHaveLength(1)
        expect(
            remove.mock.calls.filter(([type]) => type === 'storage' || type === '__posthog_browser_consent_change__')
        ).toHaveLength(1)
        expect(storage.disposed).toBe(1)
        finishExtensionDisposal?.()
        await disposal
        add.mockRestore()
        remove.mockRestore()
    })
})
