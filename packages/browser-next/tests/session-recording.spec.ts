// @vitest-environment jsdom
import { createPostHog as createRoot } from '../src/composition/npm/index'
import { createSessionRecording } from '../src/products/session-recording/session-recording'
import type { BrowserExtension } from '../src/core/context/browser-client'
import type { IPostHog } from '../src/core/types'
import { MutationThrottler } from '@posthog/browser-common/replay/mutation-throttler'
import { getRecordNetworkPlugin } from '@posthog/browser-common/replay/network-plugin'
import { isLocalhost } from '@posthog/browser-common/utils/request-utils'
import {
    clients,
    decompressEvent,
    interact,
    isCompressed,
    snapshotEvents,
    MemoryStorage,
    recordedEvents,
    recordingStatus as status,
    remoteConfig,
    resetDocument,
    setup,
    shutdownClients,
    started,
    transport,
    typeInto,
    type Transport,
} from './session-recording-helpers'

vi.mock('@posthog/browser-common/replay/network-plugin', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@posthog/browser-common/replay/network-plugin')>()
    return { ...actual, getRecordNetworkPlugin: vi.fn(actual.getRecordNetworkPlugin) }
})

vi.mock('@posthog/browser-common/utils/request-utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@posthog/browser-common/utils/request-utils')>()
    return { ...actual, isLocalhost: vi.fn(actual.isLocalhost) }
})

beforeEach(() => {
    resetDocument()
})

afterEach(async () => {
    await shutdownClients()
    vi.useRealTimers()
})

describe('session recording controls', () => {
    it('records when the project enables replay', async () => {
        const { replay } = await setup()

        await started(replay)
    })

    it('does not record when the project disables replay', async () => {
        const { replay, posthog } = await setup(false)

        await Promise.resolve()
        expect(replay.sessionRecordingStarted()).toBe(false)
        expect(status(posthog)).toBe('disabled')
    })

    it('waits for startSessionRecording when local recording is disabled', async () => {
        const { replay } = await setup({}, { disableSessionRecording: true })
        await Promise.resolve()
        expect(replay.sessionRecordingStarted()).toBe(false)

        replay.startSessionRecording()

        await started(replay)
    })

    it('is idempotent when started twice', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)

        replay.startSessionRecording()
        replay.startSessionRecording()
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        const metas = recordedEvents(network).filter((event) => event.type === 4)
        expect(metas).toHaveLength(1)
    })

    it('stops recording and sends buffered data', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)
        typeInto(document.getElementById('name') as HTMLInputElement, 'abc')

        replay.stopSessionRecording()
        await vi.waitFor(() => expect(network.snapshots.length).toBeGreaterThan(0))

        expect(replay.sessionRecordingStarted()).toBe(false)
        expect(status(posthog)).toBe('disabled')
        const sentBefore = recordedEvents(network).length
        typeInto(document.getElementById('name') as HTMLInputElement, 'abcd')
        await replay.flush?.()
        expect(recordedEvents(network)).toHaveLength(sentBefore)
    })

    it('is safe to stop when inactive', async () => {
        const { replay } = await setup({}, { disableSessionRecording: true })

        expect(() => replay.stopSessionRecording()).not.toThrow()
        expect(replay.sessionRecordingStarted()).toBe(false)
    })

    it('does not start while capture is opted out', async () => {
        const { replay } = await setup({}, { disableSessionRecording: true }, { optOutByDefault: true })

        replay.startSessionRecording(true)
        await Promise.resolve()

        expect(replay.sessionRecordingStarted()).toBe(false)
    })

    it('stops recording and drops buffered data on opt-out', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)
        typeInto(document.getElementById('name') as HTMLInputElement, 'abc')

        posthog.optOut()
        await replay.flush?.()

        expect(replay.sessionRecordingStarted()).toBe(false)
        expect(network.snapshots).toHaveLength(0)
    })

    it('contains a recorder that fails to load', async () => {
        const failing = createSessionRecording({}, () => Promise.reject(new Error('blocked')))
        const { posthog, transport: network } = await setup({}, {}, { replay: failing })

        await new Promise((resolve) => setTimeout(resolve, 0))
        posthog.capture('after')
        await posthog.flush()
        await vi.waitFor(() =>
            expect(
                network.analytics.some((event) => event.properties.$sdk_debug_recording_script_not_loaded === true)
            ).toBe(true)
        )
        expect(failing.sessionRecordingStarted()).toBe(false)
    })
})

describe('session recording debug properties', () => {
    const OPTIONAL = [
        '$sdk_debug_replay_internal_buffer_size',
        '$sdk_debug_replay_remote_trigger_matching_config',
        '$sdk_debug_session_start',
        '$sdk_debug_replay_pending_trigger_conditions',
    ]
    const captured = (
        posthog: IPostHog,
        event: string,
        properties?: Record<string, unknown>
    ): Record<string, unknown> => {
        let value: Record<string, unknown> = {}
        const subscription = posthog.onEvent((sent) => {
            value = sent.properties
        })
        posthog.capture(event, properties)
        subscription.dispose()
        return value
    }
    const optionalKeys = (properties: Record<string, unknown>): string[] =>
        OPTIONAL.filter((key) => properties[key] !== undefined)

    it('keeps optional replay diagnostics off custom and excluded events', async () => {
        const { posthog, replay } = await setup({ triggerMatchType: 'any' })
        await started(replay)

        for (const event of ['ordinary_custom', '$feature_flag_called', '$$heatmap']) {
            const properties = captured(posthog, event)
            expect(properties.$recording_status).toBe('active')
            expect(optionalKeys(properties)).toEqual([])
        }
        expect(optionalKeys(captured(posthog, '$pageview'))).toEqual(OPTIONAL)
    })

    it('reports the session start and pending trigger conditions with the optional diagnostics', async () => {
        const { posthog, replay } = await setup({ eventTriggers: ['checkout'] })
        await started(replay)

        const properties = captured(posthog, '$pageview')

        expect(properties.$recording_status).toBe('buffering')
        expect(properties.$sdk_debug_replay_pending_trigger_conditions).toEqual(['event condition not matched'])
        expect(properties.$sdk_debug_session_start).toEqual(expect.any(Number))
        expect(properties.$sdk_debug_session_start).toBeGreaterThan(0)
    })

    it('keeps an optional diagnostic the caller supplies on a custom event', async () => {
        const { posthog, replay } = await setup()
        await started(replay)

        const properties = captured(posthog, 'ordinary_custom', { $sdk_debug_replay_internal_buffer_size: 123 })

        expect(properties.$sdk_debug_replay_internal_buffer_size).toBe(123)
    })

    it('adds optional replay diagnostics to at most one SDK event every 30 seconds', async () => {
        const { posthog, replay } = await setup({ triggerMatchType: 'any' })
        await started(replay)
        vi.useFakeTimers({ toFake: ['setTimeout'] })

        expect(optionalKeys(captured(posthog, '$pageview'))).toEqual(OPTIONAL)
        expect(optionalKeys(captured(posthog, '$autocapture'))).toEqual([])
        vi.advanceTimersByTime(30_000)
        expect(optionalKeys(captured(posthog, '$autocapture'))).toEqual(OPTIONAL)
    })

    describe('while replay is intentionally off', () => {
        const replayKeys = (properties: Record<string, unknown>): Record<string, unknown> =>
            Object.fromEntries(
                Object.entries(properties).filter(
                    ([key]) =>
                        key === '$recording_status' ||
                        key.startsWith('$sdk_debug_replay_') ||
                        key.startsWith('$sdk_debug_rrweb_') ||
                        key === '$sdk_debug_recording_script_not_loaded' ||
                        key === '$sdk_debug_session_start'
                )
            )

        it('reports only the disabled status after stopSessionRecording(), and the diagnostics again on restart', async () => {
            const { posthog, replay } = await setup({
                eventTriggers: ['go'],
                urlTriggers: [{ url: 'nomatch', matching: 'regex' }],
            })
            await started(replay)
            expect(captured(posthog, 'before_stop').$sdk_debug_replay_event_trigger_status).toBe('trigger_pending')

            replay.stopSessionRecording()
            expect(replayKeys(captured(posthog, 'after_stop'))).toEqual({ $recording_status: 'disabled' })
            expect(replayKeys(captured(posthog, '$pageview'))).toEqual({ $recording_status: 'disabled' })

            replay.startSessionRecording()
            await started(replay)
            expect(captured(posthog, 'after_restart').$sdk_debug_replay_event_trigger_status).toBe('trigger_pending')
        })

        it('withholds replay diagnostics saved for the session while the project turns replay off', async () => {
            const { posthog } = await setup(false)
            posthog.registerForSession({
                $sdk_debug_replay_event_trigger_status: 'trigger_pending',
                $sdk_debug_recording_script_not_loaded: true,
            })

            expect(replayKeys(captured(posthog, '$pageview'))).toEqual({ $recording_status: 'disabled' })
        })
    })
})

describe('session recording delivery', () => {
    it('sends $snapshot batches to /s/ with session and window ids', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'hello')
        await replay.flush?.()

        expect(network.snapshots.length).toBeGreaterThan(0)
        const request = network.snapshots[0]!
        expect(request.url).toBe('https://us.i.posthog.com/s/')
        const event = request.events[0]!
        expect(event.event).toBe('$snapshot')
        expect(event.properties).toMatchObject({
            $session_id: posthog.session?.sessionId,
            $window_id: posthog.session?.windowId,
            $lib: 'web',
            distinct_id: posthog.distinctId,
            token: 'ph_test',
        })
        expect(event.properties.$snapshot_bytes).toBeGreaterThan(0)
        const types = recordedEvents(network).map((recorded) => recorded.type)
        expect(types).toContain(2)
    })

    it('uses the endpoint from remote configuration', async () => {
        const { replay, transport: network } = await setup({ endpoint: '/s/custom/' })
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'hello')
        await replay.flush?.()

        expect(network.snapshots[0]?.url).toBe('https://us.i.posthog.com/s/custom/')
    })

    it('holds a recording nobody interacted with', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)

        await replay.flush?.()

        expect(network.snapshots).toHaveLength(0)
    })

    it('ships a held fresh-start recording when a visible page unloads', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)

        window.dispatchEvent(new Event('pagehide'))

        await vi.waitFor(() => expect(network.snapshots.length).toBeGreaterThan(0))
        expect(network.snapshots[0]!.keepalive).toBe(true)
        expect(network.snapshots[0]!.url).toContain('compression=base64')
    })
})

describe('session recording attribution', () => {
    const MARKER = 'recorded-before-reset'
    const recordMarker = async (): Promise<void> => {
        const marker = document.createElement('p')
        marker.textContent = MARKER
        document.body.appendChild(marker)
        interact()
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const sentWithMarker = (network: Transport) =>
        snapshotEvents(network).find((event) =>
            JSON.stringify(
                (event.properties.$snapshot_data as Array<Record<string, any>>).map(decompressEvent)
            ).includes(MARKER)
        )

    it('keeps the opening full snapshot when the person is identified before any interaction', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)

        posthog.identify('user-1')
        document.body.appendChild(document.createElement('section'))
        await new Promise((resolve) => setTimeout(resolve, 0))
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(recordedEvents(network).map((event) => event.type)).toContain(2)
        expect(snapshotEvents(network).every((event) => event.properties.distinct_id === 'user-1')).toBe(true)
    })

    it('restarts once when analytics starts a new session', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        posthog.reset()
        posthog.capture('after reset')
        typeInto(document.getElementById('name') as HTMLInputElement, 'xx')
        await replay.flush?.()

        const next = snapshotEvents(network)
            .filter((event) => event.properties.$session_id === posthog.session!.sessionId)
            .flatMap((event) => event.properties.$snapshot_data as Array<{ type: number }>)
        expect(next.filter((event) => event.type === 4)).toHaveLength(1)
    })

    it.each([
        ['an event trigger', { eventTriggers: ['go'] }],
        ['a URL trigger', { urlTriggers: [{ url: 'localhost', matching: 'regex' as const }] }],
    ])('sends what a session activated by %s recorded before reset under the previous identity', async (_, config) => {
        const { replay, posthog, transport: network } = await setup(config)
        await started(replay)
        interact()
        posthog.capture('go')
        await replay.flush?.()
        expect(network.snapshots.length).toBeGreaterThan(0)
        const { distinctId } = posthog
        const sessionId = posthog.session?.sessionId

        // the user does something, then logs out before the next flush
        await recordMarker()
        posthog.reset()
        await replay.flush?.()

        expect(sentWithMarker(network)?.properties).toMatchObject({ $session_id: sessionId, distinct_id: distinctId })
    })

    it('keeps replay recorded before reset under optOutByDefault while core still allows delivery', async () => {
        const { replay, posthog, transport: network } = await setup({}, {}, { optOutByDefault: true })
        posthog.optIn()
        await started(replay)
        const { distinctId } = posthog
        const sessionId = posthog.session?.sessionId
        await recordMarker()
        // reset clears the opt-in, so consent returns to its default denial; core decides whether data recorded
        // before that denial may still be delivered (a cleared choice keeps it, an explicit opt-out does not)
        posthog.reset()
        await replay.flush?.()

        expect(sentWithMarker(network)?.properties).toMatchObject({ $session_id: sessionId, distinct_id: distinctId })
    })

    it('resumes replay after reset clears an explicit opt-out, under the new identity only', async () => {
        const { replay, posthog, transport: network } = await setup()
        await started(replay)
        posthog.identify('user-1')
        await replay.flush?.()
        posthog.optOut()
        const before = network.snapshots.length
        // consent listeners run after onReset restores the saved configuration, so recording can start again
        posthog.reset()
        interact()
        await new Promise((resolve) => setTimeout(resolve, 20))
        posthog.capture('after reset')
        interact()
        await replay.flush?.()
        const ids = snapshotEvents(network)
            .slice(before)
            .map((event) => event.properties.distinct_id)
        expect({ resumed: ids.length > 0, ids: [...new Set(ids)] }).toEqual({
            resumed: true,
            ids: [posthog.distinctId],
        })
    })
})

describe('session recording URLs', () => {
    afterEach(() => {
        window.history.replaceState(null, '', '/')
    })

    it('drops URL fragments from recorded page URLs', async () => {
        window.history.replaceState(null, '', '/callback#access_token=secret-token')
        const { replay, posthog, transport: network } = await setup()
        await started(replay)

        posthog.capture('$pageview', { $current_url: 'http://localhost:3000/next#access_token=secret-token' })
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        const serialized = JSON.stringify(recordedEvents(network))
        expect(serialized).toContain('http://localhost:3000/callback')
        expect(serialized).toContain('http://localhost:3000/next')
        expect(serialized).not.toContain('secret-token')
    })
})

describe('session recording compression', () => {
    it('compresses full snapshots as posthog-js does', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(isCompressed(network)).toBe(true)
        expect(recordedEvents(network).map((event) => event.type)).toContain(2)
    })
})

describe('session recording teardown', () => {
    it('stops the mutation throttler when recording stops', async () => {
        const stop = vi.spyOn(MutationThrottler.prototype, 'stop')
        const { replay } = await setup()
        await started(replay)

        replay.stopSessionRecording()

        expect(stop).toHaveBeenCalled()
    })

    /** A transport that holds the first snapshot request open until released, so later snapshots queue behind it. */
    const holdFirstSnapshot = (): Transport & { release(): void } => {
        const network = transport()
        let release: (() => void) | undefined
        const fetch: Transport['fetch'] = async (input, init) => {
            const response = network.fetch(input, init)
            if (String(input).includes('/s/') && !release) await new Promise<void>((resolve) => (release = resolve))
            return response
        }
        return { ...network, fetch, release: () => release?.() }
    }

    it('sends snapshots queued before recording stopped when the page unloads', async () => {
        const network = holdFirstSnapshot()
        const { replay } = await setup({}, {}, { transport: network })
        await started(replay)
        interact()
        void replay.flush?.()
        await vi.waitFor(() => expect(network.snapshots).toHaveLength(1))

        interact()
        replay.stopSessionRecording()
        window.dispatchEvent(new Event('pagehide'))

        await vi.waitFor(() => expect(network.snapshots).toHaveLength(2))
        network.release()
    })

    it('sends queued and buffered snapshots in one unload request while recording, so they share one allowance', async () => {
        const network = holdFirstSnapshot()
        const { replay } = await setup({}, {}, { transport: network })
        await started(replay)
        interact()
        void replay.flush?.()
        await vi.waitFor(() => expect(network.snapshots).toHaveLength(1))

        interact()
        void replay.flush?.()
        interact()
        window.dispatchEvent(new Event('pagehide'))
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(network.snapshots).toHaveLength(2)
        network.release()
    })
})

describe('session recording privacy', () => {
    it('masks input values by default', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'my-secret-value')
        await replay.flush?.()

        expect(JSON.stringify(recordedEvents(network))).not.toContain('my-secret-value')
    })

    it('records input values when masking is disabled locally, except passwords', async () => {
        const { replay, transport: network } = await setup({}, { maskAllInputs: false })
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'visible-value')
        typeInto(document.getElementById('password') as HTMLInputElement, 'password-value')
        await replay.flush?.()

        const serialized = JSON.stringify(recordedEvents(network))
        expect(serialized).toContain('visible-value')
        expect(serialized).not.toContain('password-value')
    })

    it('prefers local masking over the project setting', async () => {
        const { replay, transport: network } = await setup(
            { masking: { maskAllInputs: false } },
            { maskAllInputs: true }
        )
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'local-wins')
        await replay.flush?.()

        expect(JSON.stringify(recordedEvents(network))).not.toContain('local-wins')
    })

    it('applies the project masking setting when no local option is set', async () => {
        const { replay, transport: network } = await setup({ masking: { maskAllInputs: false } })
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'project-setting')
        await replay.flush?.()

        expect(JSON.stringify(recordedEvents(network))).toContain('project-setting')
    })

    it('blocks elements with ph-no-capture', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(JSON.stringify(recordedEvents(network))).not.toContain('hidden text')
    })

    it('masks text matching maskTextSelector', async () => {
        document.body.insertAdjacentHTML('beforeend', '<p class="pii">Jane Doe</p>')
        const { replay, transport: network } = await setup({}, { maskTextSelector: '.pii' })
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(JSON.stringify(recordedEvents(network))).not.toContain('Jane Doe')
    })
})

describe('session recording plugins', () => {
    it('records console logs when enabled locally', async () => {
        const { replay, transport: network } = await setup({}, { captureConsoleLogs: true })
        await started(replay)

        // oxlint-disable-next-line no-console
        console.warn('replayed console line')
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        const plugins = recordedEvents(network).filter((event) => event.type === 6)
        expect(JSON.stringify(plugins)).toContain('replayed console line')
    })

    it('does not record console logs unless enabled', async () => {
        const { replay, transport: network } = await setup()
        await started(replay)

        // oxlint-disable-next-line no-console
        console.warn('not replayed console line')
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(JSON.stringify(recordedEvents(network))).not.toContain('not replayed console line')
    })

    it('passes the project network capture settings through to the network plugin', async () => {
        vi.mocked(isLocalhost).mockReturnValue(false)
        try {
            const { replay } = await setup({
                networkPayloadCapture: {
                    recordHeaders: { request: false, response: true },
                    recordBody: { request: false, response: ['application/json'] },
                },
            })
            await started(replay)

            expect(vi.mocked(getRecordNetworkPlugin).mock.calls.at(-1)?.[0]).toMatchObject({
                recordHeaders: { request: false, response: true },
                recordBody: { request: false, response: ['application/json'] },
            })
        } finally {
            vi.mocked(isLocalhost).mockRestore()
        }
    })
})

describe('session recording ingestion controls', () => {
    it('does not record a session sampled out at a zero sample rate', async () => {
        const { replay, posthog, transport: network } = await setup({ sampleRate: '0.0' })
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(status(posthog)).toBe('disabled')
        expect(network.snapshots).toHaveLength(0)
    })

    it('records a session at a full sample rate', async () => {
        const { replay, posthog } = await setup({ sampleRate: '1.0' })
        await started(replay)

        expect(status(posthog)).toBe('sampled')
    })

    it('keeps the sampling decision for the session', async () => {
        const { replay, posthog } = await setup({ sampleRate: '0.5' })
        await started(replay)
        const first = status(posthog)

        replay.stopSessionRecording()
        replay.startSessionRecording()
        await started(replay)

        expect(status(posthog)).toBe(first)
    })

    it('records a sampled-out session when the sampling override is requested', async () => {
        const { replay, posthog } = await setup({ sampleRate: '0.0' }, { disableSessionRecording: true })

        replay.startSessionRecording({ sampling: true })
        await started(replay)

        expect(status(posthog)).toBe('sampled')
    })

    it('uses the local sample rate over the project rate', async () => {
        const { replay, posthog } = await setup({ sampleRate: '1.0' }, { sampleRate: 0 })
        await started(replay)

        expect(status(posthog)).toBe('disabled')
    })

    it('buffers until an event trigger is captured', async () => {
        const { replay, posthog, transport: network } = await setup({ eventTriggers: ['checkout'] })
        await started(replay)
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()
        expect(status(posthog)).toBe('buffering')
        expect(network.snapshots).toHaveLength(0)

        posthog.capture('checkout')
        await replay.flush?.()

        expect(status(posthog)).toBe('active')
        expect(network.snapshots.length).toBeGreaterThan(0)
    })

    it('activates an event trigger on the initial pageview captured before the recorder loaded', async () => {
        const {
            replay,
            posthog,
            transport: network,
        } = await setup({ eventTriggers: ['$pageview'] }, {}, { capturePageview: true })
        await started(replay)
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(status(posthog)).toBe('active')
        expect(network.snapshots.length).toBeGreaterThan(0)
        await posthog.flush()
        expect(network.analytics.filter((event) => event.event === '$pageview')).toHaveLength(1)
    })

    it('waits for a linked flag', async () => {
        let publish:
            | ((flags: Array<{ key: string; enabled: boolean; variant: string | undefined }>) => void)
            | undefined
        const flags = {
            name: 'featureFlags',
            setup() {},
            onFeatureFlags(callback: (flags: any[], errorsLoading: boolean) => void) {
                publish = (results) => callback(results, false)
                return { dispose() {} }
            },
        } as unknown as BrowserExtension
        const { replay, posthog } = await setup({ linkedFlag: 'replay-flag' }, {}, { extensions: [flags] })
        await started(replay)
        expect(status(posthog)).toBe('buffering')

        await vi.waitFor(() => expect(publish).toBeDefined())
        publish!([{ key: 'replay-flag', enabled: true, variant: undefined }])

        expect(status(posthog)).toBe('active')
    })

    it('requires the linked flag variant to match', async () => {
        let publish:
            | ((flags: Array<{ key: string; enabled: boolean; variant: string | undefined }>) => void)
            | undefined
        const flags = {
            name: 'featureFlags',
            setup() {},
            onFeatureFlags(callback: (flags: any[], errorsLoading: boolean) => void) {
                publish = (results) => callback(results, false)
                return { dispose() {} }
            },
        } as unknown as BrowserExtension
        const { replay, posthog } = await setup(
            { linkedFlag: { flag: 'replay-flag', variant: 'test' } },
            {},
            { extensions: [flags] }
        )
        await started(replay)
        await vi.waitFor(() => expect(publish).toBeDefined())

        publish!([{ key: 'replay-flag', enabled: true, variant: 'control' }])

        expect(status(posthog)).toBe('buffering')
    })

    it('pauses on a blocklisted URL', async () => {
        const {
            replay,
            posthog,
            transport: network,
        } = await setup({
            urlBlocklist: [{ url: 'localhost', matching: 'regex' }],
        })
        await started(replay)
        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(status(posthog)).toBe('paused')
        expect(network.snapshots).toHaveLength(0)
    })

    it('activates on a matching URL trigger', async () => {
        const { replay, posthog } = await setup({ urlTriggers: [{ url: 'localhost', matching: 'regex' }] })
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'x')

        expect(status(posthog)).toBe('active')
    })

    it('withholds a session shorter than the minimum duration', async () => {
        const { replay, transport: network } = await setup({ minimumDurationMilliseconds: 60_000 })
        await started(replay)

        typeInto(document.getElementById('name') as HTMLInputElement, 'x')
        await replay.flush?.()

        expect(network.snapshots).toHaveLength(0)
    })

    it('persists the remote configuration for the next page', async () => {
        const { replay, posthog } = await setup({ eventTriggers: ['checkout'] })
        await started(replay)

        expect(posthog.kv.get('$session_recording_remote_config')).toMatchObject({
            enabled: true,
            eventTriggers: ['checkout'],
        })
    })
})

describe('session replay URL', () => {
    it('links to the current session in the matching PostHog app', async () => {
        const { replay, posthog } = await setup()
        await started(replay)

        expect(replay.getSessionReplayUrl()).toBe(
            `https://us.posthog.com/project/ph_test/replay/${posthog.session?.sessionId}`
        )
    })

    it('adds a playback offset with a look back', async () => {
        const { replay, posthog } = await setup()
        await started(replay)
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(posthog.session!.sessionStartTimestamp + 60_000)

        expect(replay.getSessionReplayUrl({ withTimestamp: true, timestampLookBack: 15 })).toMatch(/\?t=45$/)
    })

    it('uses the client UI host', async () => {
        const { replay } = await setup({}, {}, { uiHost: 'https://eu.posthog.com/' })
        await started(replay)

        expect(replay.getSessionReplayUrl()).toMatch(/^https:\/\/eu\.posthog\.com\/project\/ph_test\/replay\//)
    })

    it('is empty before a session exists', async () => {
        const { replay } = await setup(false)

        expect(replay.getSessionReplayUrl()).toBe('')
    })
})

describe('session recording composition', () => {
    it('loads automatically when remote configuration enables replay', async () => {
        const posthog = await createRoot({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: new MemoryStorage(),
            navigator: false,
            fetch: transport().fetch,
            flags: false,
            remoteConfig: remoteConfig({}),
        })
        clients.push(posthog)

        expect(posthog.sessionRecording).toBeDefined()
    })

    it('does not load when remote configuration disables replay', async () => {
        const posthog = await createRoot({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: new MemoryStorage(),
            navigator: false,
            fetch: transport().fetch,
            flags: false,
            remoteConfig: remoteConfig(false),
        })
        clients.push(posthog)

        expect(posthog.sessionRecording).toBeUndefined()
    })

    it('does not load when disabled locally', async () => {
        const posthog = await createRoot({
            projectToken: 'ph_test',
            capturePageview: false,
            storage: new MemoryStorage(),
            navigator: false,
            fetch: transport().fetch,
            flags: false,
            sessionRecording: false,
            remoteConfig: remoteConfig({}),
        })
        clients.push(posthog)

        expect(posthog.sessionRecording).toBeUndefined()
    })
})
