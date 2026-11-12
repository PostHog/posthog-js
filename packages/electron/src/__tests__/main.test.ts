// @vitest-environment jsdom
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, powerMonitor, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
    COMMAND_CHANNEL,
    MAX_MESSAGE_BYTES,
    type Command,
    type Response as BridgeResponse,
    type State,
} from '../shared/protocol'

const mock = vi.hoisted(() => ({
    handlers: new Map<string, (event: IpcMainInvokeEvent, value: unknown) => Promise<BridgeResponse>>(),
    fetch: vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(),
}))
vi.mock('electron', async () => {
    const { EventEmitter } = await import('node:events')
    const app = Object.assign(new EventEmitter(), {
        whenReady: () => Promise.resolve(),
        getName: () => 'test-app',
        getVersion: () => '1.0.0',
        getPath: () => tmpdir(),
        quit: vi.fn(),
    })
    return {
        app,
        powerMonitor: new EventEmitter(),
        ipcMain: {
            handle: (key: string, callback: (event: IpcMainInvokeEvent, value: unknown) => Promise<BridgeResponse>) =>
                mock.handlers.set(key, callback),
            removeHandler: (key: string) => mock.handlers.delete(key),
        },
        session: { fromPartition: () => ({ fetch: mock.fetch }) },
    }
})
import { init, type PostHog } from '../main'
import { ElectronStorage } from '../main/storage'
import { PostHog as RendererPostHog } from '../renderer'

let directory: string
let client: PostHog | undefined
let batches: { event: string; distinct_id: string; properties: Record<string, any> }[]

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'posthog-electron-test-'))
    batches = []
    mock.fetch.mockImplementation(async (_url, options) => {
        const body = JSON.parse(options?.body as string)
        if (body.batch) batches.push(...body.batch)
        return new Response(
            JSON.stringify({ featureFlags: { test: 'variant' }, featureFlagPayloads: { test: '{"color":"blue"}' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    })
})
afterEach(async () => {
    await client?.shutdown(50)
    client = undefined
    await rm(directory, { recursive: true, force: true })
    vi.useRealTimers()
})

async function start(options = {}) {
    client = init({
        projectToken: 'test-token',
        storageDirectory: directory,
        captureAppLifecycleEvents: false,
        preloadFeatureFlags: false,
        disableCompression: true,
        flushInterval: 0,
        fetchRetryCount: 0,
        ...options,
    })
    await client.ready()
    return client
}

function renderer(owner: PostHog, id: number) {
    const mainFrame = { routingId: id * 10, url: 'file:///app/index.html', send: vi.fn() }
    const contents = Object.assign(new EventEmitter(), {
        id,
        mainFrame,
        getURL: () => mainFrame.url,
        isDestroyed: () => false,
        isFocused: (): boolean => false,
    })
    const window = Object.assign(new EventEmitter(), { webContents: contents }) as unknown as BrowserWindow
    owner.registerWindow(window, { allowedUrls: ['file:///app/index.html'] })
    const event = { sender: contents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
    let sequence = 0
    const send = async (
        command: Command,
        generation = owner.getState().generation,
        override = event
    ): Promise<BridgeResponse> => {
        return mock.handlers.get(COMMAND_CHANNEL)!(override, { version: 1, sequence: ++sequence, generation, command })
    }
    return {
        send,
        contents,
        event,
        focus: () => {
            contents.isFocused = () => true
            window.emit('focus')
        },
        blur: () => {
            contents.isFocused = () => false
            window.emit('blur')
        },
    }
}

async function publicClient(owner: PostHog, process: 'main' | 'renderer') {
    if (process === 'main') return { api: owner, dispose: () => {} }
    const window = renderer(owner, 1)
    const api = new RendererPostHog({
        request: (request) => mock.handlers.get(COMMAND_CHANNEL)!(window.event, request),
        subscribe: (callback) => {
            window.contents.mainFrame.send.mockImplementation((_channel, state) => callback(state))
            return () => window.contents.mainFrame.send.mockReset()
        },
    })
    await api.ready()
    return { api, dispose: () => api.dispose() }
}

describe.each(['main', 'renderer'] as const)('%s public contracts through the main boundary', (process) => {
    it('aliases without switching identity, captures screens and updates the current person through core', async () => {
        const owner = await start()
        const { api, dispose } = await publicClient(owner, process)
        const anonymous = api.getAnonymousId()
        expect(anonymous).not.toBe('')
        await api.alias(' ')
        await api.screen(' ')
        await api.setPersonProperties()
        await api.alias('linked-user')
        expect(api.getDistinctId()).toBe(anonymous)
        expect(api.getAnonymousId()).toBe(anonymous)
        await api.screen('Home', {
            tab: 'main',
            $screen_name: 'cannot-override',
            ...(process === 'renderer' ? { $electron_process: 'main', $window_id: 'spoofed' } : {}),
        })
        await api.setPersonProperties({ plan: 'pro' }, { source: 'signup' })
        await api.setPersonProperties({ plan: 'pro' }, { source: 'signup' })
        await api.identify('alice')
        expect(api.getAnonymousId()).toBe(anonymous)
        await api.flush()
        expect(batches.filter(({ event }) => event === '$create_alias')).toHaveLength(1)
        expect(batches.filter(({ event }) => event === '$screen')).toHaveLength(1)
        expect(batches.find(({ event }) => event === '$create_alias')).toMatchObject({
            distinct_id: anonymous,
            properties: { alias: 'linked-user', distinct_id: anonymous, $electron_process: process },
        })
        expect(batches.find(({ event }) => event === '$screen')).toMatchObject({
            distinct_id: anonymous,
            properties: { $screen_name: 'Home', tab: 'main', $electron_process: process },
        })
        if (process === 'renderer')
            expect(batches.find(({ event }) => event === '$screen')?.properties.$window_id).toBe('1')
        expect(batches.filter(({ event }) => event === '$set')).toHaveLength(1)
        expect(batches.find(({ event }) => event === '$set')).toMatchObject({
            distinct_id: anonymous,
            properties: { $set: { plan: 'pro' }, $set_once: { source: 'signup' }, $electron_process: process },
        })
        dispose()
    })

    it('merges, reloads and resets flag context without analytics events or caller mutation', async () => {
        const owner = await start()
        const { api, dispose } = await publicClient(owner, process)
        const person = { nested: { plan: 'pro' } }
        const setting = api.setPersonPropertiesForFlags(person, false)
        person.nested.plan = 'mutated'
        await setting
        await api.setPersonPropertiesForFlags({ region: 'eu' }, false)
        const groups = { company: { tier: 'pro' } }
        await api.setGroupPropertiesForFlags(groups, false)
        await api.setGroupPropertiesForFlags({ company: { seats: 10 }, team: { name: 'sdk' } }, false)
        expect(groups).toEqual({ company: { tier: 'pro' } })
        expect(mock.fetch).not.toHaveBeenCalled()
        await api.reloadFeatureFlags()
        const requestBody = () => JSON.parse(mock.fetch.mock.calls.at(-1)![1]!.body as string)
        expect(requestBody()).toMatchObject({
            person_properties: { nested: { plan: 'pro' }, region: 'eu' },
            group_properties: { company: { tier: 'pro', seats: 10 }, team: { name: 'sdk' } },
        })
        await api.resetPersonPropertiesForFlags()
        await api.resetGroupPropertiesForFlags()
        expect(mock.fetch).toHaveBeenCalledTimes(1)
        await api.reloadFeatureFlagsAsync()
        expect(requestBody()).toMatchObject({ person_properties: {}, group_properties: {} })
        await api.setPersonPropertiesForFlags({ plan: 'enterprise' })
        expect(requestBody()).toMatchObject({ person_properties: { plan: 'enterprise' } })
        await api.setGroupPropertiesForFlags({ company: { plan: 'enterprise' } })
        expect(requestBody()).toMatchObject({ group_properties: { company: { plan: 'enterprise' } } })
        await api.resetPersonPropertiesForFlags(true)
        await api.resetGroupPropertiesForFlags(true)
        expect(requestBody()).toMatchObject({ person_properties: {}, group_properties: {} })
        await api.flush()
        expect(batches).toEqual([])
        dispose()
    })

    it('reads copied structured results, preserves disabled and empty variants and sends only requested exposures', async () => {
        const owner = await start()
        const { api, dispose } = await publicClient(owner, process)
        expect(api.getFeatureFlagResult('missing', { sendFeatureFlagEvent: false })).toBeUndefined()
        expect(api.getAllFeatureFlags()).toEqual([])
        expect(api.isFeatureEnabled('missing', { defaultValue: true, sendFeatureFlagEvent: false })).toBe(true)
        mock.fetch.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    featureFlags: { experiment: 'blue', off: false, empty: '' },
                    featureFlagPayloads: { experiment: '{"copy":"new"}' },
                })
            )
        )
        await api.reloadFeatureFlags()
        const silent = { sendFeatureFlagEvent: false, sendEvent: true }
        expect(api.getFeatureFlagResult('experiment', silent)).toEqual({
            key: 'experiment',
            enabled: true,
            variant: 'blue',
            payload: { copy: 'new' },
        })
        expect(api.getFeatureFlagResult('off', silent)).toMatchObject({ key: 'off', enabled: false })
        expect(api.getFeatureFlagResult('off', silent)?.variant).toBeUndefined()
        expect(api.getFeatureFlagResult('empty', silent)).toMatchObject({ key: 'empty', enabled: false, variant: '' })
        expect(api.isFeatureEnabled('empty', { ...silent, defaultValue: true })).toBe(false)
        expect(api.isFeatureEnabled('off', { ...silent, defaultValue: true })).toBe(false)
        expect(api.isFeatureEnabled('missing', { ...silent, defaultValue: true })).toBe(true)
        expect(api.getFeatureFlagResult('missing', silent)).toBeUndefined()
        expect(api.getFeatureFlag('missing', silent)).toBe(false)
        const results = api.getAllFeatureFlags()
        ;(results.find(({ key }) => key === 'experiment')!.payload as { copy: string }).copy = 'mutated'
        const payload = api.getFeatureFlagPayload('experiment') as { copy: string }
        payload.copy = 'also-mutated'
        expect(api.getFeatureFlagPayload('experiment')).toEqual({ copy: 'new' })
        await api.flush()
        expect(batches).toEqual([])
        api.getFeatureFlagResult('experiment')
        api.isFeatureEnabled('off', { sendFeatureFlagEvent: true, sendEvent: false })
        api.getFeatureFlag('empty', { sendEvent: false })
        await api.flush()
        expect(
            batches
                .filter(({ event }) => event === '$feature_flag_called')
                .map(({ properties }) => properties.$feature_flag)
        ).toEqual(['experiment', 'off'])
        dispose()
    })

    it('keeps valid result values and enabled states when payload decoding fails', async () => {
        const onError = vi.fn()
        const owner = await start({ onError })
        const { api, dispose } = await publicClient(owner, process)
        mock.fetch.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    flags: {
                        experiment: {
                            key: 'experiment',
                            enabled: true,
                            variant: 'blue',
                            metadata: { payload: '{broken' },
                        },
                        off: { key: 'off', enabled: false, metadata: { payload: '' } },
                        empty: { key: 'empty', enabled: true, variant: '', metadata: { payload: '   ' } },
                    },
                })
            )
        )
        await api.reloadFeatureFlags()
        const silent = { sendFeatureFlagEvent: false }
        expect(api.getFeatureFlagResult('experiment', silent)).toMatchObject({
            enabled: true,
            variant: 'blue',
            payload: null,
        })
        expect(api.getFeatureFlagResult('off', silent)).toMatchObject({ enabled: false, payload: null })
        expect(api.getFeatureFlagResult('empty', silent)).toMatchObject({ enabled: false, variant: '', payload: null })
        expect(api.getFeatureFlag('experiment', silent)).toBe('blue')
        expect(api.isFeatureEnabled('off', silent)).toBe(false)
        for (const key of ['experiment', 'off', 'empty']) {
            expect(api.getFeatureFlagPayload(key)).toBeNull()
            expect(api.getState().featureFlagPayloads[key]).toBeNull()
            expect(api.getAllFeatureFlags().find((result) => result.key === key)?.payload).toBeNull()
        }
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('could not decode payload') })
        )
        await api.flush()
        expect(batches).toEqual([])
        dispose()
    })

    it('preserves decoded payload types and legacy string provenance without heuristic reparsing', async () => {
        const owner = await start()
        const { api, dispose } = await publicClient(owner, process)
        const values = [false, 0, null, [], { color: 'blue' }, '', 'false', '{broken']
        mock.fetch.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    flags: Object.fromEntries(
                        values.map((value, i) => [
                            `flag-${i}`,
                            { key: `flag-${i}`, enabled: true, metadata: { payload: JSON.stringify(value) } },
                        ])
                    ),
                })
            )
        )
        await api.reloadFeatureFlags()
        for (const [i, value] of values.entries()) {
            expect(api.getFeatureFlagPayload(`flag-${i}`)).toEqual(value)
            expect(api.getFeatureFlagResult(`flag-${i}`, { sendFeatureFlagEvent: false })?.payload).toEqual(value)
        }
        // Core has already turned malformed legacy bytes into a valid serialized string; provenance is lost.
        mock.fetch.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    featureFlags: { legacy: true },
                    featureFlagPayloads: { legacy: '{broken' },
                })
            )
        )
        await api.reloadFeatureFlags()
        expect(api.getFeatureFlagPayload('legacy')).toBe('{broken')
        expect(api.getFeatureFlagResult('legacy', { sendFeatureFlagEvent: false })?.payload).toBe('{broken')
        await api.flush()
        expect(batches).toEqual([])
        dispose()
    })

    it('gates new event helpers on consent and person-profile configuration', async () => {
        const owner = await start({ personProfiles: 'never' })
        const { api, dispose } = await publicClient(owner, process)
        await api.alias('no-person')
        await api.setPersonProperties({ email: 'no-person' })
        await api.optOut()
        expect(api.optedOut).toBe(true)
        expect(api.hasOptedOutCapturing()).toBe(true)
        mock.fetch.mockClear()
        await api.alias('secret')
        await api.screen('secret')
        await api.setPersonProperties({ email: 'secret' })
        await api.flush()
        expect(mock.fetch).not.toHaveBeenCalled()
        expect(batches).toEqual([])
        dispose()
    })
})

describe('main Electron client', () => {
    it('opts in to monitor-only exception capture without changing host error handlers', async () => {
        const monitors = process.rawListeners('uncaughtExceptionMonitor')
        const uncaught = process.rawListeners('uncaughtException')
        const rejections = process.rawListeners('unhandledRejection')
        const owner = await start({ enableExceptionAutocapture: true })
        await owner.ready()
        expect(process.rawListeners('uncaughtExceptionMonitor')).toHaveLength(monitors.length + 1)
        expect(process.rawListeners('uncaughtException')).toEqual(uncaught)
        expect(process.rawListeners('unhandledRejection')).toEqual(rejections)
        // Unit dispatch only; the installed-package fixture raises real asynchronous throws/rejections.
        EventEmitter.prototype.emit.call(
            process,
            'uncaughtExceptionMonitor',
            new TypeError('main throw'),
            'uncaughtException'
        )
        EventEmitter.prototype.emit.call(
            process,
            'uncaughtExceptionMonitor',
            new RangeError('main rejection'),
            'unhandledRejection'
        )
        await owner.captureException(new Error('manual'))
        await owner.flush()
        expect(batches).toHaveLength(3)
        expect(batches[0]).toMatchObject({
            event: '$exception',
            properties: {
                $electron_process: 'main',
                $exception_source: 'node.process_uncaught_exception',
                $exception_list: [
                    {
                        type: 'TypeError',
                        value: 'main throw',
                        mechanism: { type: 'onuncaughtexception', handled: false },
                    },
                ],
            },
        })
        expect(batches[0].properties.$exception_list[0].stacktrace.frames.length).toBeGreaterThan(0)
        expect(batches[1]).toMatchObject({
            properties: {
                $exception_source: 'node.process_unhandled_rejection',
                $exception_list: [{ mechanism: { type: 'onunhandledrejection', handled: false } }],
            },
        })
        expect(batches[2]).toMatchObject({
            properties: { $exception_list: [{ mechanism: { type: 'generic', handled: true } }] },
        })
        expect(batches[2].properties).not.toHaveProperty('$exception_source')
        await owner.shutdown(100)
        expect(process.rawListeners('uncaughtExceptionMonitor')).toEqual(monitors)
        expect(process.rawListeners('uncaughtException')).toEqual(uncaught)
        expect(process.rawListeners('unhandledRejection')).toEqual(rejections)
        const replacement = await start({ enableExceptionAutocapture: true })
        expect(process.rawListeners('uncaughtExceptionMonitor')).toHaveLength(monitors.length + 1)
        await replacement.shutdown(100)
        expect(process.rawListeners('uncaughtExceptionMonitor')).toEqual(monitors)
    })

    it('defaults to no global listeners and gates error getters and persistence before opt-out capture', async () => {
        const monitors = process.rawListeners('uncaughtExceptionMonitor')
        const owner = await start()
        expect(process.rawListeners('uncaughtExceptionMonitor')).toEqual(monitors)
        await owner.shutdown(100)
        const optedOut = await start({ enableExceptionAutocapture: true, defaultOptIn: false })
        await optedOut.optOut()
        const getter = vi.fn(() => {
            throw new Error('private getter')
        })
        const secret = Object.defineProperty(new Error(), 'message', { get: getter })
        const persist = vi.spyOn(ElectronStorage.prototype, 'flush')
        persist.mockClear()
        EventEmitter.prototype.emit.call(process, 'uncaughtExceptionMonitor', secret, 'uncaughtException')
        await optedOut.captureException(secret)
        await Promise.resolve()
        expect(getter).not.toHaveBeenCalled()
        expect(persist).not.toHaveBeenCalled()
        expect(batches).toEqual([])
        await optedOut.optIn()
        EventEmitter.prototype.emit.call(process, 'uncaughtExceptionMonitor', new Error('allowed'), 'uncaughtException')
        await optedOut.flush()
        expect(batches).toHaveLength(1)
    })

    it('checks consent again when queued exception work executes', async () => {
        const owner = await start({ enableExceptionAutocapture: true })
        const getter = vi.fn(() => {
            throw new Error('must not inspect')
        })
        const optOut = owner.optOut()
        const capture = owner.captureException(Object.defineProperty({}, 'message', { get: getter }))
        await optOut
        await expect(capture).rejects.toThrow('Stale PostHog identity')
        expect(getter).not.toHaveBeenCalled()
        expect(batches).toEqual([])
    })
    it('reports an unchanged malformed flag payload once before a callback captures the SDK error', async () => {
        const captures: Promise<void>[] = []
        const onError = vi.fn((error: unknown) => {
            // Finite guard proves recursive reporting without risking an unbounded test loop.
            if (onError.mock.calls.length <= 3) captures.push(owner.captureException(error))
        })
        const owner = await start({ onError })
        mock.fetch.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    flags: {
                        broken: { key: 'broken', enabled: true, variant: 'blue', metadata: { payload: '{broken' } },
                    },
                })
            )
        )
        await owner.reloadFeatureFlags()
        await Promise.all(captures)
        await owner.flush()
        expect(owner.getFeatureFlagPayload('broken')).toBeNull()
        expect(owner.getFeatureFlagResult('broken', { sendFeatureFlagEvent: false })).toMatchObject({
            variant: 'blue',
            payload: null,
        })
        owner.getState()
        owner.getState()
        await owner.flush()
        expect(onError).toHaveBeenCalledTimes(1)
        expect(batches.filter(({ event }) => event === '$exception')).toHaveLength(1)
        mock.fetch.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    flags: {
                        broken: { key: 'broken', enabled: true, metadata: { payload: '{different' } },
                        another: { key: 'another', enabled: false, metadata: { payload: ' ' } },
                    },
                })
            )
        )
        await owner.reloadFeatureFlags()
        await Promise.all(captures)
        await owner.flush()
        expect(onError).toHaveBeenCalledTimes(3)
        mock.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ flags: {} })))
        await owner.reloadFeatureFlags()
        expect(owner.getFeatureFlagPayload('broken')).toBeNull()
        mock.fetch.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    flags: {
                        broken: { key: 'broken', enabled: true, metadata: { payload: '{different' } },
                    },
                })
            )
        )
        await owner.reloadFeatureFlags()
        expect(onError).toHaveBeenCalledTimes(4)
    })
    it.each(['screen', 'set', 'setOnce'] as const)('does not inspect opted-out %s properties', async (operation) => {
        const owner = await start()
        await owner.optOut()
        const inspect = vi.fn(() => {
            throw new Error('opted-out properties must not be inspected')
        })
        const properties = Object.defineProperty({}, 'secret', { get: inspect, enumerable: true })
        if (operation === 'screen') await owner.screen('Private', properties)
        else if (operation === 'set') await owner.setPersonProperties(properties)
        else await owner.setPersonProperties(undefined, properties)
        expect(inspect).not.toHaveBeenCalled()
    })

    it('awaits readiness for early helpers and keeps identity getters local before initialization', async () => {
        let release!: () => void
        const load = ElectronStorage.prototype.load
        vi.spyOn(ElectronStorage.prototype, 'load').mockImplementationOnce(async function (this: ElectronStorage) {
            await new Promise<void>((resolve) => {
                release = resolve
            })
            await load.call(this)
        })
        client = init({
            projectToken: 'test-token',
            storageDirectory: directory,
            captureAppLifecycleEvents: false,
            preloadFeatureFlags: false,
            disableCompression: true,
            flushInterval: 0,
        })
        expect(client.getAnonymousId()).toBe('')
        expect(client.getDistinctId()).toBe('')
        let completed = false
        const aliasing = client.alias('known-user').then(() => {
            completed = true
        })
        await Promise.resolve()
        expect(completed).toBe(false)
        expect(mock.fetch).not.toHaveBeenCalled()
        release()
        await aliasing
        const anonymous = client.getAnonymousId()
        expect(anonymous).not.toBe('')
        await client.flush()
        expect(batches).toMatchObject([
            { event: '$create_alias', distinct_id: anonymous, properties: { alias: 'known-user' } },
        ])
    })

    it('waits for earlier mutations before reloading flags without blocking later identity changes', async () => {
        const owner = await start()
        let release!: () => void
        vi.spyOn(ElectronStorage.prototype, 'flush').mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve
                })
        )
        const registering = owner.register({ workspace: 'one' })
        await vi.waitFor(() => expect(release).toBeTypeOf('function'))
        const identifying = owner.identify('alice')
        const reloading = owner.reloadFeatureFlags()
        await Promise.resolve()
        expect(mock.fetch).not.toHaveBeenCalled()
        release()
        await Promise.all([registering, identifying, reloading])
        expect(mock.fetch.mock.calls.length).toBeGreaterThan(0)
        for (const [, options] of mock.fetch.mock.calls) {
            expect(JSON.parse(options!.body as string).distinct_id).toBe('alice')
        }
    })

    it.each(['identity', 'navigation'] as const)('rechecks queued renderer reload %s authorization', async (change) => {
        const owner = await start()
        const window = renderer(owner, 1)
        await window.send({ type: 'hello' })
        let release!: () => void
        vi.spyOn(ElectronStorage.prototype, 'flush').mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve
                })
        )
        const registering = owner.register({ workspace: 'one' })
        await vi.waitFor(() => expect(release).toBeTypeOf('function'))
        const reloading = window.send({ type: 'reloadFeatureFlags' })
        await Promise.resolve()
        if (change === 'navigation') window.contents.mainFrame.url = 'file:///not-allowed.html'
        const identifying = change === 'identity' ? owner.identify('bob') : Promise.resolve()
        release()
        await Promise.all([registering, identifying])
        expect(await reloading).toMatchObject({
            ok: false,
            error: expect.stringContaining(change === 'identity' ? 'Stale' : 'navigated'),
        })
    })

    it('applies sender/frame, size, generation and rate limits to new helper commands', async () => {
        const owner = await start()
        const window = renderer(owner, 1)
        await window.send({ type: 'hello' })
        expect(
            await window.send({ type: 'screen', name: 'Home', properties: { huge: 'x'.repeat(MAX_MESSAGE_BYTES) } })
        ).toMatchObject({ ok: false, error: expect.stringContaining('256 KiB') })
        const subframe = {
            ...window.event,
            senderFrame: { routingId: 999, url: 'file:///app/index.html' },
        } as unknown as IpcMainInvokeEvent
        expect(await window.send({ type: 'alias', alias: 'bad' }, 0, subframe)).toMatchObject({
            ok: false,
            error: expect.stringContaining('Unauthorized'),
        })
        const generation = owner.getState().generation
        await owner.reset()
        expect(
            await window.send({ type: 'setPersonProperties', properties: { private: true } }, generation)
        ).toMatchObject({ ok: false, error: expect.stringContaining('Stale') })
        let response: BridgeResponse | undefined
        for (let i = 0; i < 100; i++)
            response = await window.send({ type: 'resetPersonPropertiesForFlags', reloadFeatureFlags: false })
        expect(response).toMatchObject({ ok: false, error: expect.stringContaining('rate limit') })
        await owner.flush()
        expect(batches).toEqual([])
    })
    it('acknowledges an in-flight capture only after its state rename even when shutdown times out', async () => {
        const { promises: fs } = await import('node:fs')
        const { dirname } = await import('node:path')
        const owner = await start()
        let release!: () => void
        const write = fs.writeFile.bind(fs)
        vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
            await new Promise<void>((resolve) => {
                release = resolve
            })
            await write(...args)
        })
        const rename = fs.rename.bind(fs)
        let committed = false
        vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => {
            expect(await fs.readFile(join(dirname(String(args[1])), '.owner'), 'utf8')).toContain(String(process.pid))
            await rename(...args)
            committed = true
        })
        let acknowledged = false
        const capture = owner.capture('pending-shutdown').then(() => {
            acknowledged = true
        })
        const flushing = owner.flush()
        await vi.waitFor(() => expect(release).toBeTypeOf('function'))
        await owner.shutdown(1)
        expect(acknowledged).toBe(false)
        expect(committed).toBe(false)
        release()
        await Promise.all([capture, flushing])
        expect(committed).toBe(true)
        const namespace = (await fs.readdir(directory))[0]
        const persisted = JSON.parse(await fs.readFile(join(directory, namespace, 'state.json'), 'utf8'))
        expect(persisted.values.queue.map((item: any) => item.message.event)).toContain('pending-shutdown')
        await vi.waitFor(async () => expect(await fs.readdir(join(directory, namespace))).toEqual(['state.json']))
    })
    it('keeps the existing bridge authorized when a navigation never commits', async () => {
        const owner = await start()
        const page = renderer(owner, 1)
        await page.send({ type: 'hello' })
        page.contents.emit('did-start-navigation', {}, 'https://example.invalid/download', false, true)
        expect(await page.send({ type: 'capture', event: 'after-aborted-navigation' })).toMatchObject({ ok: true })
        await owner.flush()
        expect(batches.map((event) => event.event)).toEqual(['after-aborted-navigation'])
        page.contents.emit('did-navigate', {}, 'file:///app/index.html', 200, 'OK')
        expect(await page.send({ type: 'capture', event: 'before-new-handshake' })).toMatchObject({ ok: false })
        expect(await page.send({ type: 'hello' })).toMatchObject({ ok: true })
        expect(await page.send({ type: 'capture', event: 'after-new-handshake' })).toMatchObject({ ok: true })
    })
    it('counts cold start and aggregate focus transitions once across windows', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const owner = await start({ captureAppLifecycleEvents: true })
        const first = renderer(owner, 1),
            second = renderer(owner, 2)
        first.focus()
        first.blur()
        second.focus()
        await vi.advanceTimersByTimeAsync(50)
        await owner.flush()
        expect(batches.filter((event) => event.event === 'Application Opened')).toHaveLength(1)
        expect(batches.some((event) => event.event === 'Application Backgrounded')).toBe(false)
        second.blur()
        await vi.advanceTimersByTimeAsync(50)
        await owner.flush()
        expect(batches.filter((event) => event.event === 'Application Backgrounded')).toHaveLength(1)
        first.focus()
        await owner.flush()
        expect(batches.filter((event) => event.event === 'Application Opened')).toHaveLength(2)
        await owner.shutdown(50)
        vi.useRealTimers()
    })

    it('delivers live events when before_send preserves a Date timestamp', async () => {
        const owner = await start({ before_send: (event: unknown) => event })
        await owner.capture('with-hook')
        await owner.flush()
        expect(batches.map((event) => event.event)).toEqual(['with-hook'])
    })

    it('reports consecutive distinct flag reads against the same flag snapshot after session rotation', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const owner = await start(),
            window = renderer(owner, 1)
        await window.send({ type: 'hello' })
        mock.fetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ featureFlags: { first: true, second: 'test' } }))
        )
        await owner.reloadFeatureFlagsAsync()
        const observed = owner.getState()
        vi.setSystemTime(Date.now() + 31 * 60 * 1000)
        await window.send({ type: 'flag', key: 'first', value: true, flagRevision: observed.flagRevision })
        await window.send({ type: 'flag', key: 'second', value: 'test', flagRevision: observed.flagRevision })
        await owner.flush()
        expect(
            batches
                .filter((event) => event.event === '$feature_flag_called')
                .map((event) => event.properties.$feature_flag)
        ).toEqual(['first', 'second'])
    })

    it('does not persist or evaluate groups supplied by an opted-out capture', async () => {
        const owner = await start()
        await owner.optOut()
        mock.fetch.mockClear()
        await owner.capture('blocked', { $groups: { org: 'private' } })
        await owner.captureException(new Error('blocked'), { $groups: { org: 'private' } })
        await owner.group('org', 'private')
        await owner.flush()
        expect(mock.fetch).not.toHaveBeenCalled()
    })

    it('does not send expired queued events', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const owner = await start({ maxQueueAgeMs: 10 })
        await owner.capture('expired')
        vi.setSystemTime(Date.now() + 20)
        await owner.flush()
        expect(batches).toEqual([])
    })

    it('does not record an exposure for a newer variant than the renderer observed', async () => {
        const owner = await start(),
            window = renderer(owner, 1)
        await window.send({ type: 'hello' })
        await owner.reloadFeatureFlagsAsync()
        const observed = owner.getState()
        mock.fetch.mockResolvedValue(new Response(JSON.stringify({ featureFlags: { test: 'new-variant' } })))
        await owner.reloadFeatureFlagsAsync()
        mock.fetch.mockImplementation(async (_url, options) => {
            const body = JSON.parse(options?.body as string)
            if (body.batch) batches.push(...body.batch)
            return new Response('{}')
        })
        await window.send({ type: 'flag', key: 'test', value: 'variant', flagRevision: observed.flagRevision })
        await owner.flush()
        expect(batches.filter((event) => event.event === '$feature_flag_called')).toEqual([])
    })

    it('rejects stale flags across the whole request including retries', async () => {
        const owner = await start({ fetchRetryDelay: 20 }),
            window = renderer(owner, 1)
        await window.send({ type: 'hello' })
        let started!: () => void
        const firstAttempt = new Promise<void>((resolve) => {
            started = resolve
        })
        mock.fetch.mockImplementationOnce(async () => {
            started()
            return new Response(null, { status: 502 })
        })
        mock.fetch.mockImplementationOnce(
            async () => new Response(JSON.stringify({ featureFlags: { old_user_flag: true } }))
        )
        const loading = owner.reloadFeatureFlagsAsync()
        await firstAttempt
        await owner.identify('new-user')
        await loading
        await owner.reloadFeatureFlagsAsync()
        const snapshots = window.contents.mainFrame.send.mock.calls.map(([, state]) => state as State)
        expect(snapshots.some((state) => state.featureFlags.old_user_flag)).toBe(false)
    })

    it('does not bootstrap or persist identity after startup exceeds the shutdown budget', async () => {
        let release!: () => void
        const load = ElectronStorage.prototype.load
        vi.spyOn(ElectronStorage.prototype, 'load').mockImplementationOnce(async function (this: ElectronStorage) {
            await new Promise<void>((resolve) => {
                release = resolve
            })
            await load.call(this)
        })
        const set = vi.spyOn(ElectronStorage.prototype, 'set')
        client = init({
            projectToken: 'test-token',
            storageDirectory: directory,
            preloadFeatureFlags: false,
            captureAppLifecycleEvents: false,
        })
        await client.shutdown(1)
        set.mockClear()
        release()
        await client.ready()
        expect(set).not.toHaveBeenCalled()
    })

    it('shares identity, group context and session across two windows without changing queued attribution', async () => {
        const owner = await start()
        const first = renderer(owner, 1),
            second = renderer(owner, 2)
        await first.send({ type: 'hello' })
        await second.send({ type: 'hello' })
        const anonymous = owner.getDistinctId()
        expect((await first.send({ type: 'capture', event: 'before' })).ok).toBe(true)
        await first.send({ type: 'identify', distinctId: 'alice' })
        await first.send({ type: 'group', groupType: 'org', groupKey: 'acme' })
        expect((await second.send({ type: 'capture', event: 'after' })).ok).toBe(true)
        await owner.flush()
        expect(batches.find((event) => event.event === 'before')?.distinct_id).toBe(anonymous)
        const after = batches.find((event) => event.event === 'after')!
        expect(after.distinct_id).toBe('alice')
        expect(after.properties).toMatchObject({
            $electron_process: 'renderer',
            $window_id: '2',
            $groups: { org: 'acme' },
        })
        expect(after.properties.$session_id).toBe(owner.getSessionId())
        expect(batches.find((event) => event.event === '$identify')?.properties.$electron_process).toBe('renderer')
    })

    it('rejects unauthorized windows, subframes, remote navigation and stale identity commands', async () => {
        const owner = await start(),
            first = renderer(owner, 1)
        await first.send({ type: 'hello' })
        const oldGeneration = owner.getState().generation
        await owner.identify('alice')
        expect(await first.send({ type: 'capture', event: 'stale' }, oldGeneration)).toMatchObject({
            ok: false,
            error: expect.stringContaining('Stale'),
        })
        const subframe = {
            ...first.event,
            senderFrame: { routingId: 999, url: 'file:///app/index.html' },
        } as unknown as IpcMainInvokeEvent
        expect((await first.send({ type: 'hello' }, 0, subframe)).ok).toBe(false)
        first.contents.mainFrame.url = 'https://evil.example/'
        expect((await first.send({ type: 'hello' })).ok).toBe(false)
        await owner.flush()
        expect(batches.some((event) => event.event === 'stale')).toBe(false)
    })

    it('persists consent before early captures, preserves it on reset, and retains events accepted before opt out', async () => {
        const owner = await start()
        await owner.capture('not-yet-sent')
        await owner.optOut()
        await owner.reset()
        expect(owner.optedOut).toBe(true)
        await owner.shutdown(50)
        client = undefined
        const restarted = await start()
        await restarted.capture('forbidden')
        await restarted.flush()
        expect(batches.map((event) => event.event)).toEqual(['not-yet-sent'])
        await restarted.optIn()
        await restarted.capture('allowed')
        await restarted.flush()
        expect(batches.map((event) => event.event)).toEqual(['not-yet-sent', 'allowed'])
    })

    it('retains transient HTTP failures on disk and recovers after restart without regenerating UUIDs', async () => {
        const owner = await start()
        await owner.capture('offline')
        const anonymous = owner.getDistinctId()
        mock.fetch.mockResolvedValue(new Response('unavailable', { status: 503 }))
        await expect(owner.flush()).rejects.toThrow()
        await owner.shutdown(50)
        client = undefined
        mock.fetch.mockImplementation(async (_url, options) => {
            batches.push(...JSON.parse(options?.body as string).batch)
            return new Response('{}')
        })
        const restarted = await start()
        expect(restarted.getDistinctId()).toBe(anonymous)
        await restarted.flush()
        expect(batches).toHaveLength(1)
        expect(batches[0]).toMatchObject({ event: 'offline', distinct_id: anonymous })
        expect(batches[0]).toHaveProperty('uuid')
    })

    it('discards flag responses from an old identity and distributes only the latest values', async () => {
        const owner = await start()
        let resolve!: (value: Response) => void
        mock.fetch.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done
                })
        )
        const loading = owner.reloadFeatureFlagsAsync()
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
        await owner.identify('bob')
        resolve(new Response(JSON.stringify({ featureFlags: { old_user_flag: true } })))
        await loading
        await owner.reloadFeatureFlagsAsync()
        expect(owner.getState().featureFlags).toEqual({ test: 'variant' })
        expect(owner.getState().featureFlags).not.toHaveProperty('old_user_flag')
    })

    it('stops new work and returns within a shutdown budget when networking hangs', async () => {
        const owner = await start()
        await owner.capture('pending')
        mock.fetch.mockImplementation(() => new Promise(() => {}))
        const shutdown = owner.shutdown(10)
        await shutdown
        expect(owner.shutdown()).toBe(shutdown)
        expect(mock.handlers.has(COMMAND_CHANNEL)).toBe(false)
        await expect(owner.capture('after-shutdown')).rejects.toThrow('shut down')
    })
    it('gates opted-out capture before exception/property inspection and disk mutation but permits identify flags', async () => {
        const owner = await start()
        await owner.optOut()
        const set = vi.spyOn(ElectronStorage.prototype, 'set')
        const inspect = vi.fn(() => {
            throw new Error('must not inspect analytics')
        })
        const properties = Object.defineProperty({}, '$groups', { get: inspect, enumerable: true })
        const error = Object.defineProperty({}, 'message', { get: inspect })
        await owner.capture('blocked', properties)
        await owner.captureException(error, properties)
        await owner.group('org', 'private', properties)
        expect(inspect).not.toHaveBeenCalled()
        expect(set).not.toHaveBeenCalled()
        await owner.identify('flags-only')
        await vi.waitFor(() => expect(mock.fetch).toHaveBeenCalled())
        await owner.flush()
        expect(batches).toEqual([])
    })

    it('cancels ready promptly while Electron readiness is deferred, with no late initialization', async () => {
        let release!: () => void
        vi.spyOn(app, 'whenReady').mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    release = resolve
                })
        )
        client = init({ projectToken: 'test-token', storageDirectory: directory })
        await vi.waitFor(() => expect(release).toBeTypeOf('function'))
        // No startup lifecycle, flags, or networking may run after the timeout.
        await client.shutdown(1)
        await client.ready()
        const set = vi.spyOn(ElectronStorage.prototype, 'set')
        release()
        await Promise.resolve()
        await Promise.resolve()
        expect(set).not.toHaveBeenCalled()
        expect(mock.fetch).not.toHaveBeenCalled()
    })

    it('bounds shutdown even when ownership acquisition is deferred and releases a late lock', async () => {
        const { promises: fs } = await import('node:fs')
        let release!: () => void
        const mkdir = fs.mkdir.bind(fs)
        vi.spyOn(fs, 'mkdir').mockImplementationOnce(async (...args) => {
            await new Promise<void>((resolve) => {
                release = resolve
            })
            return mkdir(...args)
        })
        const onError = vi.fn()
        client = init({ projectToken: 'test-token', storageDirectory: directory, onError })
        await vi.waitFor(() => expect(release).toBeTypeOf('function'))
        await client.shutdown(1)
        await client.ready()
        expect(onError).toHaveBeenCalledTimes(1)
        release()
        await vi.waitFor(async () => {
            const namespaces = await fs.readdir(directory)
            expect(namespaces).toHaveLength(1)
            expect(await fs.readdir(join(directory, namespaces[0]))).toEqual([])
        })
        expect(mock.fetch).not.toHaveBeenCalled()
    })

    it.each(['before', 'after'])('preserves %s-listener will-quit cancellation and client usability', async (order) => {
        const cancel = (event: Electron.Event) => event.preventDefault()
        if (order === 'before') app.on('will-quit', cancel)
        const owner = await start()
        if (order === 'after') app.on('will-quit', cancel)
        try {
            await owner.capture('before-cancelled-quit')
            const event = {
                defaultPrevented: false,
                preventDefault() {
                    this.defaultPrevented = true
                },
            }
            app.emit('will-quit', event)
            await Promise.resolve()
            expect(app.quit).not.toHaveBeenCalled()
            expect(mock.fetch).not.toHaveBeenCalled()
            await owner.capture('still-running')
            await owner.flush()
            expect(batches.map(({ event }) => event)).toEqual(['before-cancelled-quit', 'still-running'])
        } finally {
            app.removeListener('will-quit', cancel)
        }
    })

    it('best-effort will-quit flush does not prevent quit, tear down, or install fatal error handlers', async () => {
        const uncaught = process.listenerCount('uncaughtException')
        const rejected = process.listenerCount('unhandledRejection')
        const owner = await start()
        await owner.capture('best-effort')
        const event = { defaultPrevented: false, preventDefault: vi.fn() }
        app.emit('will-quit', event)
        await vi.waitFor(() => expect(batches).toHaveLength(1))
        expect(event.preventDefault).not.toHaveBeenCalled()
        expect(app.quit).not.toHaveBeenCalled()
        await owner.capture('usable')
        expect(process.listenerCount('uncaughtException')).toBe(uncaught)
        expect(process.listenerCount('unhandledRejection')).toBe(rejected)
    })

    it('registers exactly one per-SDK exit listener and removes it on each shutdown', async () => {
        const baseline = process.listeners('exit')
        for (let i = 0; i < 2; i++) {
            const owner = await start()
            expect(init({ projectToken: 'test-token', storageDirectory: directory })).toBe(owner)
            expect(process.listeners('exit')).toHaveLength(baseline.length + 1)
            await owner.shutdown(50)
            await owner.shutdown(50)
            expect(process.listeners('exit')).toEqual(baseline)
        }
    })

    it('suspend pauses delivery and resume flushes without synthetic activity or session renewal', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const owner = await start()
        const session = owner.getSessionId()
        await owner.capture('before-sleep')
        powerMonitor.emit('suspend')
        await expect(owner.flush()).rejects.toThrow('paused')
        expect(mock.fetch).not.toHaveBeenCalled()
        vi.setSystemTime(Date.now() + 31 * 60 * 1000)
        powerMonitor.emit('resume')
        await vi.waitFor(() => expect(batches).toHaveLength(1))
        expect(owner.getSessionId()).toBe(session)
        expect(batches.map(({ event }) => event)).toEqual(['before-sleep'])
        await owner.capture('real-activity')
        expect(owner.getSessionId()).not.toBe(session)
        await owner.shutdown(50)
        expect(powerMonitor.listenerCount('suspend')).toBe(0)
        expect(powerMonitor.listenerCount('resume')).toBe(0)
    })

    it('closing all registered windows backgrounds once but keeps tray delivery active', async () => {
        const owner = await start({ captureAppLifecycleEvents: true })
        const window = renderer(owner, 1)
        window.focus()
        window.contents.emit('destroyed')
        app.emit('window-all-closed')
        await owner.capture('tray-action')
        await owner.flush()
        expect(batches.filter(({ event }) => event === 'Application Backgrounded')).toHaveLength(1)
        expect(batches.filter(({ event }) => event === 'tray-action')).toHaveLength(1)
        expect(app.quit).not.toHaveBeenCalled()
    })
})

describe('main-routed autocapture config', () => {
    async function load(owner: PostHog, id = 91) {
        const window = renderer(owner, id)
        await window.send({ type: 'hello' })
        return window.send({ type: 'loadAutocaptureConfig' })
    }

    it('fetches core remote config on demand, mirrors and persists only autocapture fields', async () => {
        const owner = await start()
        expect(mock.fetch).not.toHaveBeenCalled()
        mock.fetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    autocapture_opt_out: false,
                    elementsChainAsString: true,
                    sessionRecording: { endpoint: 'UNSUPPORTED_CONFIG_CANARY' },
                    surveys: [{ id: 'UNSUPPORTED_CONFIG_CANARY' }],
                    productTours: true,
                    logs: { captureConsoleLogs: true },
                    hasFeatureFlags: true,
                })
            )
        )
        expect(await load(owner)).toMatchObject({
            ok: true,
            state: {
                autocapture: {
                    status: 'loaded',
                    autocapture_opt_out: false,
                    elementsChainAsString: true,
                },
            },
        })
        expect(mock.fetch).toHaveBeenCalledTimes(1)
        expect(mock.fetch.mock.calls[0][0]).toBe('https://us-assets.i.posthog.com/array/test-token/config')
        expect(mock.fetch.mock.calls[0][1]?.method).toBe('GET')
        const { readdir, readFile } = await import('node:fs/promises')
        const files = await readdir(directory, { recursive: true })
        const text = await readFile(
            join(
                directory,
                files.find((file) => file.endsWith('state.json'))!
            ),
            'utf8'
        )
        expect(JSON.parse(text).values.remote_config).toEqual({
            autocapture_opt_out: false,
            elementsChainAsString: true,
        })
        expect(text).not.toContain('UNSUPPORTED_CONFIG_CANARY')
        expect(JSON.stringify(owner.getState())).not.toMatch(/sessionRecording|surveys|productTours|captureConsoleLogs/)
        expect(owner.getState().flagsLoaded).toBe(false)
    })

    it('keeps a persisted project kill switch through reset, restart, malformed response and fetch failure', async () => {
        let owner = await start()
        mock.fetch.mockResolvedValue(new Response(JSON.stringify({ autocapture_opt_out: true })))
        await load(owner)
        await owner.reset()
        expect(owner.getState().autocapture?.autocapture_opt_out).toBe(true)
        await owner.shutdown(50)
        owner = await start()
        expect(owner.getState().autocapture).toEqual({ status: 'pending', autocapture_opt_out: true })
        mock.fetch.mockResolvedValue(
            new Response(JSON.stringify({ autocapture_opt_out: 'false', elementsChainAsString: 'true' }))
        )
        await load(owner)
        expect(owner.getState().autocapture).toEqual({ status: 'loaded', autocapture_opt_out: true })
        mock.fetch.mockRejectedValue(new Error('offline'))
        await load(owner, 92)
        expect(owner.getState().autocapture).toEqual({ status: 'failed', autocapture_opt_out: true })
    })

    it.each([{ defaultOptIn: false }, { disabled: true }, { disableRemoteConfig: true }])(
        'does not fetch when gated by %j',
        async (options) => {
            const owner = await start(options)
            await load(owner)
            expect(mock.fetch).not.toHaveBeenCalled()
            if ('disabled' in options) expect(owner.getState().autocapture?.autocapture_opt_out).toBe(true)
            if ('disableRemoteConfig' in options) expect(owner.getState().autocapture?.status).toBe('disabled')
        }
    )

    it('does not treat disabled feature flags as disabling the authoritative config request', async () => {
        const owner = await start({ disableRemoteFeatureFlags: true })
        mock.fetch.mockResolvedValue(new Response(JSON.stringify({ autocapture_opt_out: true })))
        await load(owner)
        expect(mock.fetch).toHaveBeenCalledOnce()
        expect(owner.getState().autocapture).toEqual({ status: 'loaded', autocapture_opt_out: true })
    })

    it.each(['identify', 'reset'] as const)(
        'enables cold-start autocapture after %s during a pending project config load',
        async (change) => {
            const owner = await start({ disableRemoteFeatureFlags: true })
            const page = renderer(owner, 95)
            let resolve!: (response: Response) => void
            mock.fetch.mockImplementation(async (_url, options) => {
                if (options?.method === 'GET')
                    return new Promise((done) => {
                        resolve = done
                    })
                const body = JSON.parse(options?.body as string)
                if (body.batch) batches.push(...body.batch)
                return new Response('{}')
            })
            const first = load(owner, 94)
            await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
            if (change === 'identify') await owner.identify('new-account')
            else await owner.reset()
            const facade = new RendererPostHog(
                {
                    request: (request) => mock.handlers.get(COMMAND_CHANNEL)!(page.event, request),
                    subscribe: (listener) => {
                        page.contents.mainFrame.send.mockImplementation((_channel, state) => listener(state))
                        return () => page.contents.mainFrame.send.mockReset()
                    },
                },
                { autocapture: true }
            )
            try {
                await facade.ready()
                await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
                await vi.waitFor(() => expect(facade.getState().generation).toBe(owner.getState().generation))
                resolve(new Response(JSON.stringify({ autocapture_opt_out: false, elementsChainAsString: true })))
                await first
                await facade.flush()
                expect(facade.getState().autocapture).toEqual({
                    status: 'loaded',
                    autocapture_opt_out: false,
                    elementsChainAsString: true,
                })
                expect(mock.fetch.mock.calls.filter(([, options]) => options?.method === 'GET')).toHaveLength(1)
                mock.fetch.mockImplementation(async (_url, options) => {
                    const body = JSON.parse(options?.body as string)
                    if (body.batch) batches.push(...body.batch)
                    return new Response('{}')
                })
                document.body.innerHTML = '<button>Save</button>'
                document.querySelector('button')!.click()
                await facade.flush()
                expect(batches.filter(({ event }) => event === '$autocapture')).toHaveLength(1)
                expect(batches.find(({ event }) => event === '$autocapture')?.distinct_id).toBe(owner.getDistinctId())
            } finally {
                facade.dispose()
                document.body.innerHTML = ''
            }
        }
    )

    it('deduplicates concurrent project config loads across identity changes', async () => {
        const owner = await start({ disableRemoteFeatureFlags: true })
        let resolve!: (response: Response) => void
        mock.fetch.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done
                })
        )
        const first = load(owner, 93)
        const second = load(owner, 94)
        await vi.waitFor(() => expect(mock.fetch).toHaveBeenCalledOnce())
        await owner.identify('new-account')
        resolve(new Response(JSON.stringify({ autocapture_opt_out: false })))
        await Promise.all([first, second])
        mock.fetch.mockImplementation(async () => new Response('{}'))
        expect(owner.getState().autocapture).toEqual({ status: 'loaded', autocapture_opt_out: false })
    })

    it('does not persist project config returned after opt-out', async () => {
        const owner = await start()
        let resolve!: (response: Response) => void
        mock.fetch.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done
                })
        )
        const pending = load(owner)
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
        await owner.optOut()
        resolve(new Response(JSON.stringify({ autocapture_opt_out: false })))
        await pending
        expect(owner.getState().autocapture).toEqual({ status: 'failed' })
    })

    it('ignores a delayed config response after shutdown', async () => {
        const owner = await start()
        let resolve!: (response: Response) => void
        mock.fetch.mockImplementation(
            () =>
                new Promise((done) => {
                    resolve = done
                })
        )
        const pending = load(owner)
        await vi.waitFor(() => expect(mock.fetch).toHaveBeenCalledOnce())
        await owner.shutdown(1)
        resolve(new Response(JSON.stringify({ autocapture_opt_out: false })))
        await pending
        expect(owner.getState().autocapture?.autocapture_opt_out).toBe(true)
    })
})
