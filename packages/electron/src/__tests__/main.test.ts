import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, powerMonitor, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { COMMAND_CHANNEL, type Command, type Response as BridgeResponse, type State } from '../shared/protocol'

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

describe('main Electron client', () => {
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
        vi.spyOn(ElectronStorage.prototype, 'load').mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve
                })
        )
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
