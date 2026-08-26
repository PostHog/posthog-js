import type { Client, Extension } from '@posthog/browser-common'

import { analytics } from '../src/analytics'
import { createPostHog } from '../src'
import { createFetch, MemoryStorage, type SentRequest } from './helpers'

class TestDocument extends EventTarget {
    constructor(public visibilityState: DocumentVisibilityState) {
        super()
    }
}

class ObservableStorage extends MemoryStorage {
    private readonly _listeners = new Set<() => void>()

    override setItem(key: string, value: string): void {
        super.setItem(key, value)
        for (const listener of this._listeners) {
            listener()
        }
    }

    subscribe(_key: string, listener: () => void): { dispose(): void } {
        this._listeners.add(listener)
        return { dispose: () => this._listeners.delete(listener) }
    }
}

describe('browser-next initial pageview', () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

    afterEach(() => {
        jest.restoreAllMocks()
        if (originalDocument) {
            Object.defineProperty(globalThis, 'document', originalDocument)
        } else {
            delete (globalThis as Record<string, unknown>).document
        }
    })

    const setDocument = (document: TestDocument): void => {
        Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
    }

    it('admits one default pageview after configured extensions install and before the factory resolves', async () => {
        const document = new TestDocument('visible')
        setDocument(document)
        const order: string[] = []
        let pageviewProperties: Readonly<Record<string, unknown>> | undefined
        const extension: Extension = {
            name: 'observer',
            setup(client: Client) {
                order.push('setup')
                client.onEvent(({ event, properties }) => {
                    order.push(event)
                    if (event === '$pageview') {
                        pageviewProperties = properties
                    }
                })
            },
        }

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [extension],
        })

        expect(order).toEqual(['setup', '$pageview'])
        expect(pageviewProperties).not.toHaveProperty('title')
        expect(pageviewProperties).not.toHaveProperty('$current_url')
        expect(posthog.session.sessionId).not.toBe('')
        await posthog.capture('explicit')
        expect(order).toEqual(['setup', '$pageview', 'explicit'])
    })

    it('does no pageview DOM work when disabled', async () => {
        const document = jest.fn(() => {
            throw new Error('document should not be read')
        })
        Object.defineProperty(globalThis, 'document', { configurable: true, get: document })

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            fetch: false,
        })

        expect(document).not.toHaveBeenCalled()
        expect(posthog.session).toEqual({ sessionId: '', windowId: '', sessionStartTimestamp: 0 })
    })

    it('waits for a hidden document and captures once when it becomes visible', async () => {
        const document = new TestDocument('hidden')
        const add = jest.spyOn(document, 'addEventListener')
        const remove = jest.spyOn(document, 'removeEventListener')
        setDocument(document)
        const observed: string[] = []
        const extension: Extension = {
            name: 'observer',
            setup(client) {
                client.onEvent(({ event }) => observed.push(event))
            },
        }
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            extensions: [extension],
        })

        expect(observed).toEqual([])
        expect(add.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)
        document.visibilityState = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
        document.dispatchEvent(new Event('visibilitychange'))

        expect(observed).toEqual(['$pageview'])
        expect(remove.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)
        expect(posthog.session.sessionId).not.toBe('')
    })

    it.each([
        ['default denial', undefined],
        ['prior denial', '0'],
    ])('keeps the pageview pending across %s until opt-in', async (_name, priorConsent) => {
        const storage = new MemoryStorage()
        if (priorConsent) {
            storage.values.set('__ph_opt_in_out_ph_test', priorConsent)
        }
        const document = new TestDocument('visible')
        const documentRead = jest.fn(() => document)
        Object.defineProperty(globalThis, 'document', { configurable: true, get: documentRead })
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            optOutByDefault: priorConsent ? false : true,
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))

        expect(documentRead).not.toHaveBeenCalled()
        expect(posthog.session).toEqual({ sessionId: '', windowId: '', sessionStartTimestamp: 0 })
        posthog.optIn()

        expect(documentRead).toHaveBeenCalledTimes(1)
        expect(observed).toEqual(['$pageview'])
    })

    it('removes a hidden listener on explicit denial and retries only after opt-in', async () => {
        const document = new TestDocument('hidden')
        const remove = jest.spyOn(document, 'removeEventListener')
        setDocument(document)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))

        posthog.optOut()
        document.visibilityState = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
        expect(observed).toEqual([])
        expect(remove.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)

        posthog.optIn()
        expect(observed).toEqual(['$pageview'])
    })

    it('does not admit under a new consent generation after denial and regrant during DOM access', async () => {
        const storage = new ObservableStorage()
        const controller = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage,
            navigator: false,
            fetch: false,
        })
        const document = new TestDocument('visible')
        const observed: string[] = []
        const extension: Extension = {
            name: 'observer',
            setup(client) {
                client.onEvent(({ event }) => observed.push(event))
            },
        }
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            get() {
                controller.optOut()
                controller.optIn()
                return document
            },
        })

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
            extensions: [extension],
        })

        expect(posthog.hasOptedOut()).toBe(false)
        expect(observed).toEqual([])
        setDocument(document)
        posthog.optIn()
        expect(observed).toEqual(['$pageview'])
    })

    it('keeps a visible pageview single-flight during reentrant opt-in', async () => {
        const document = new TestDocument('hidden')
        setDocument(document)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => {
            observed.push(event)
            if (event === '$pageview') {
                posthog.optIn()
            }
        })

        document.visibilityState = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))

        expect(observed).toEqual(['$pageview'])
    })

    it('does not admit an automatic pageview across a consent-generation change', async () => {
        const storage = new MemoryStorage()
        const controller = await createPostHog({
            projectToken: 'ph_test',
            capturePageview: false,
            storage,
            navigator: false,
            fetch: false,
        })
        const document = new TestDocument('visible')
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            get() {
                controller.optOut()
                return document
            },
        })

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage,
            navigator: false,
            fetch: false,
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))

        expect(observed).toEqual([])
        expect(posthog.hasOptedOut()).toBe(true)
    })

    it('does not read the document for a bot-blocked client', async () => {
        const document = jest.fn(() => {
            throw new Error('document should not be read')
        })
        Object.defineProperty(globalThis, 'document', { configurable: true, get: document })

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: { webdriver: true },
            fetch: false,
        })

        expect(document).not.toHaveBeenCalled()
        expect(posthog.session).toEqual({ sessionId: '', windowId: '', sessionStartTimestamp: 0 })
    })

    it('contains missing and hostile document capabilities', async () => {
        delete (globalThis as Record<string, unknown>).document
        await expect(
            createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        ).resolves.toBeDefined()

        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            get() {
                throw new Error('document failed')
            },
        })
        await expect(
            createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        ).resolves.toBeDefined()

        const hostile = {
            visibilityState: 'hidden',
            addEventListener: () => {
                throw new Error('listener failed')
            },
        }
        Object.defineProperty(globalThis, 'document', { configurable: true, value: hostile })
        await expect(
            createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        ).resolves.toBeDefined()
    })

    it('moves a hidden listener to a replacement document and captures from the replacement', async () => {
        const first = new TestDocument('hidden')
        const second = new TestDocument('hidden')
        const removeFirst = jest.spyOn(first, 'removeEventListener')
        const addSecond = jest.spyOn(second, 'addEventListener')
        setDocument(first)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))

        setDocument(second)
        first.dispatchEvent(new Event('visibilitychange'))
        second.visibilityState = 'visible'
        second.dispatchEvent(new Event('visibilitychange'))

        expect(removeFirst.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)
        expect(addSecond.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)
        expect(observed).toEqual(['$pageview'])
    })

    it('removes an old hidden listener when document access later fails', async () => {
        const document = new TestDocument('hidden')
        const remove = jest.spyOn(document, 'removeEventListener')
        setDocument(document)
        await createPostHog({ projectToken: 'ph_test', storage: false, navigator: false, fetch: false })
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            get() {
                throw new Error('document failed')
            },
        })

        document.dispatchEvent(new Event('visibilitychange'))

        expect(remove.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)
    })

    it('buffers the initial pageview without delivery and drains it after analytics installs', async () => {
        setDocument(new TestDocument('visible'))
        const requests: SentRequest[] = []
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: createFetch(requests),
        })

        await posthog.flush()
        expect(requests).toEqual([])
        await posthog.installExtension(analytics())
        await posthog.flush()

        expect((requests[0]?.body?.batch as Array<{ event: string }> | undefined)?.[0]?.event).toBe('$pageview')
        expect(requests).toHaveLength(1)
    })

    it('removes a hidden-document listener during disposal', async () => {
        const document = new TestDocument('hidden')
        const remove = jest.spyOn(document, 'removeEventListener')
        setDocument(document)
        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
        })

        await posthog.dispose()
        document.visibilityState = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))

        expect(remove.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)
        expect(posthog.session).toEqual({ sessionId: '', windowId: '', sessionStartTimestamp: 0 })
    })

    it('retries a pageview after active delivery capacity becomes available', async () => {
        setDocument(new TestDocument('visible'))
        let finish: ((response: Response) => void) | undefined
        const firstResponse = new Promise<Response>((resolve) => {
            finish = resolve
        })
        const fetch = jest
            .fn()
            .mockImplementationOnce(() => firstResponse)
            .mockResolvedValue(new Response('{}', { status: 200 }))
        const observed: string[] = []
        const producer: Extension = {
            name: 'producer',
            async setup(client) {
                client.onEvent(({ event }) => observed.push(event))
                await client.capture('large', { value: 'a'.repeat(8_387_700) })
            },
        }

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch,
            extensions: [producer, analytics()],
        })

        expect(observed).toEqual(['large'])
        expect(fetch).toHaveBeenCalledTimes(1)
        finish?.(new Response('{}', { status: 200 }))
        await posthog.flush()
        await Promise.resolve()
        await posthog.flush()

        expect(observed).toEqual(['large', '$pageview'])
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('does not wait for configured analytics delivery to complete', async () => {
        setDocument(new TestDocument('visible'))
        let finish: ((response: Response) => void) | undefined
        const response = new Promise<Response>((resolve) => {
            finish = resolve
        })
        const fetch = jest.fn(() => response)

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch,
            extensions: [analytics()],
        })
        await Promise.resolve()

        expect(posthog.session.sessionId).not.toBe('')
        expect(fetch).toHaveBeenCalledTimes(1)
        finish?.(new Response('{}', { status: 200 }))
        await posthog.flush()
        await posthog.dispose()
    })

    it('does not wait for or start remote configuration', async () => {
        setDocument(new TestDocument('visible'))
        const loader = jest.fn(() => new Promise<never>(() => {}))

        const posthog = await createPostHog({
            projectToken: 'ph_test',
            storage: false,
            navigator: false,
            fetch: false,
            remoteConfigLoader: loader,
        })

        expect(loader).not.toHaveBeenCalled()
        expect(posthog.session.sessionId).not.toBe('')
    })

    it('uses UTF-8 bytes for admission and does not publish rejected work or lose a pending session reason', async () => {
        jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
        try {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
            const observed: string[] = []
            const sessions: string[] = []
            const posthog = await createPostHog({
                projectToken: 'ph_test',
                capturePageview: false,
                storage: false,
                navigator: false,
                fetch: false,
                debug: true,
            })
            posthog.onEvent(({ event }) => observed.push(event))
            posthog.onNewSession(({ reason }) => sessions.push(reason))
            await posthog.capture('ascii', { value: 'a'.repeat(4_194_304) })
            jest.advanceTimersByTime(1_800_001)

            await posthog.capture('private_multibyte', { value: '😀'.repeat(2_097_152) })

            expect(observed).toEqual(['ascii'])
            expect(sessions).toEqual([])
            const warning = warn.mock.calls.flat().join(' ')
            expect(warning).toContain('private_multibyte')
            expect(warning).toContain('bytes')
            expect(warning).not.toContain('😀')

            await posthog.capture('after_drop')
            expect(observed).toEqual(['ascii', 'after_drop'])
            expect(sessions).toEqual(['idleTimeout'])
        } finally {
            jest.useRealTimers()
        }
    })
})
