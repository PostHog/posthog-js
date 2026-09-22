import { SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP, SESSION_RECORDING_FLUSHED_SIZE } from '../../../constants'
import { createReplayRecorderClient, replayOptions } from '../../../extensions/replay/replay-host'
import { sessionStore } from '../../../storage'
import { createPosthogInstance } from '../../helpers/posthog-instance'

const createInstance = () =>
    createPosthogInstance(undefined, {
        disable_session_recording: true,
        capture_pageview: false,
        request_batching: true,
    })

describe('replay host boundary', () => {
    afterEach(() => vi.restoreAllMocks())

    it('preserves timestamped activity checks and the constructor/start activity default', async () => {
        const instance = await createInstance()
        const host = createReplayRecorderClient(instance).replay
        const check = vi.spyOn(instance.sessionManager!, 'checkAndGetSessionAndWindowId')
        host.checkSession()
        host.checkSession({ timestamp: 123, updateActivity: false })
        host.checkSession({ timestamp: 456, updateActivity: true })
        expect(check.mock.calls).toEqual([
            [false, undefined],
            [true, 123],
            [false, 456],
        ])
        await instance.shutdown()
    })

    it('delivers session changes synchronously with reasons and suppresses a replaced owner', async () => {
        const instance = await createInstance()
        const manager = instance.sessionManager!
        let notify!: Parameters<typeof manager.onSessionId>[0]
        const unsubscribe = vi.fn()
        vi.spyOn(manager, 'onSessionId').mockImplementation((callback) => {
            notify = callback
            callback('current', 'tab')
            return unsubscribe
        })
        const host = createReplayRecorderClient(instance).replay
        const callback = vi.fn()
        const subscription = host.onSessionChange(callback)
        expect(callback).toHaveBeenCalledWith('current', 'tab')
        const reason = { noSessionId: false, activityTimeout: true, sessionPastMaximumLength: false }
        notify('next', 'tab', reason)
        expect(callback).toHaveBeenLastCalledWith('next', 'tab', reason)
        instance.sessionManager = undefined
        expect(host.sessionActive).toBe(false)
        notify('stale', 'tab', reason)
        expect(callback).toHaveBeenCalledTimes(2)
        subscription.dispose()
        subscription.dispose()
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        instance.sessionManager = manager
        await instance.shutdown()
    })

    it('uses the snapshot capture pipeline with recording transport semantics and no ordinary enrichment', async () => {
        const instance = await createInstance()
        instance.set_config({ before_send: (event) => event })
        const client = createReplayRecorderClient(instance)
        const capture = vi.spyOn(instance, 'capture')
        const enqueue = vi.spyOn(instance._requestQueue!, 'enqueue')
        instance.register({ ordinary: 'property' })
        instance._getBrowserClientAdapter().registerDynamicEventProperties(() => ({ dynamic: 'property' }))
        const properties = {
            $session_id: 'recorded-session',
            $window_id: 'recorded-tab',
            $snapshot_data: ['x'.repeat(10000)],
        }
        client.replay.captureSnapshot('/custom-replay/', properties)
        expect(capture).toHaveBeenCalledWith('$snapshot', properties, {
            _url: instance.requestRouter.endpointFor('api', '/custom-replay/'),
            _noTruncate: true,
            _batchKey: 'recordings',
            skip_client_rate_limiting: true,
        })
        expect(enqueue).toHaveBeenCalledWith(
            expect.objectContaining({
                url: instance.requestRouter.endpointFor('api', '/custom-replay/'),
                batchKey: 'recordings',
                timestampMode: 'body',
                compression: 'best-available',
                data: expect.objectContaining({
                    event: '$snapshot',
                    properties: expect.objectContaining(properties),
                }),
            })
        )
        const queued = enqueue.mock.calls[0][0]
        expect(queued.batchGroup).toContain('recorded-session')
        expect(queued.batchGroup).toContain('recorded-tab')
        expect(queued.data.properties).not.toHaveProperty('ordinary')
        expect(queued.data.properties).not.toHaveProperty('dynamic')
        await instance.shutdown()
    })

    it('pins the flushed-size writer and preserves set_property rather than register semantics', async () => {
        const instance = await createInstance()
        const persistence = instance.persistence!
        const set = vi.spyOn(persistence, 'set_property')
        const register = vi.spyOn(persistence, 'register')
        const write = createReplayRecorderClient(instance).replay.createFlushedSizeWriter()
        register.mockClear()
        const value = { sessionId: 'session', size: 123 }
        write(value)
        expect(set).toHaveBeenCalledWith(SESSION_RECORDING_FLUSHED_SIZE, value)
        expect(register).not.toHaveBeenCalled()
        await instance.shutdown()
    })

    it.each([undefined, 'None', 123])('preserves the first-snapshot unset policy for %s', async (previous) => {
        const instance = await createInstance()
        const host = createReplayRecorderClient(instance).replay
        instance.persistence!.set_property(SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP, previous)
        host.recordFirstSnapshot(456)
        expect(instance.get_property(SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP)).toBe(
            previous === 'None' ? 456 : previous
        )
        instance.persistence!.unregister(SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP)
        host.recordFirstSnapshot(789)
        expect(instance.get_property(SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP)).toBe(789)
        await instance.shutdown()
    })

    it('pins pending buffers to the recorder project and tab key with live availability', async () => {
        const instance = await createInstance()
        vi.spyOn(sessionStore, '_is_supported').mockReturnValue(true)
        const write = vi.spyOn(sessionStore, '_set').mockReturnValue(true)
        const read = vi.spyOn(sessionStore, '_parse').mockReturnValue({ parked: true })
        const remove = vi.spyOn(sessionStore, '_remove').mockImplementation(() => {})
        const key =
            'ph_replay_pending_buffer_' +
            JSON.stringify([instance.config.persistence_name || instance.config.token, instance.config.token])
        const store = createReplayRecorderClient(instance).replay.createPendingBufferStore()
        instance.config.persistence_name = 'changed-after-construction'
        store.write({ parked: true })
        expect(write).toHaveBeenCalledWith(key, { parked: true })
        expect(store.read()).toEqual({ parked: true })
        expect(read).toHaveBeenCalledWith(key)
        instance.config.persistence = 'memory'
        write.mockClear()
        read.mockClear()
        expect(store.enabled).toBe(false)
        expect(store.read()).toBeUndefined()
        store.write({ private: true })
        expect(write).not.toHaveBeenCalled()
        expect(read).not.toHaveBeenCalled()
        store.remove()
        expect(remove).toHaveBeenCalledWith(key)
        await instance.shutdown()
    })

    it('reads live replay options without copying the recording callback object', async () => {
        const instance = await createInstance()
        const first = replayOptions(instance)
        expect(first.recording).toBe(instance.config.session_recording)
        const mask = () => null
        instance.set_config({ session_recording: { maskCapturedNetworkRequestFn: mask, sampleRate: 0 } })
        expect(replayOptions(instance).recording).toBe(instance.config.session_recording)
        expect(replayOptions(instance).recording.maskCapturedNetworkRequestFn).toBe(mask)
        expect(replayOptions(instance).recording.sampleRate).toBe(0)
        await instance.shutdown()
    })

    it('constructs the full diagnostic config payload only in the host', async () => {
        const instance = await createInstance()
        const emit = vi.fn(() => true)
        createReplayRecorderClient(instance).replay.emitConfigEvent(emit)
        expect(emit).toHaveBeenCalledWith('$posthog_config', { config: instance.config })
        await instance.shutdown()
    })
})
