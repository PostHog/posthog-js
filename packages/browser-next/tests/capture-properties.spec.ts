import { createBufferedPostHog as createPostHog } from './helpers'
import { requireInstalledExtension } from './helpers'
import { localRemoteConfig } from './helpers'
import { analytics } from '../src/products/analytics/analytics'
import type { CaptureV1Event } from '../src/products/analytics/delivery/capture-v1'
import {
    applySessionProperties,
    snapshotCaptureProperties,
    unavoidableProperties,
} from '../src/products/analytics/admission/capture-properties'

const nullableProperties = {
    test: null,
    missing: undefined,
    nested: { drop: null, missing: undefined },
    items: ['1', null, 2, { drop: null }, [null], undefined],
    empty: '',
    zero: 0,
    enabled: false,
    literal: 'null',
    literalUndefined: 'undefined',
    emptyObject: {},
    emptyArray: [],
}

const cleanedProperties = {
    nested: {},
    items: ['1', null, 2, {}, [null], null],
    empty: '',
    zero: 0,
    enabled: false,
    literal: 'null',
    literalUndefined: 'undefined',
    emptyObject: {},
    emptyArray: [],
}

describe.each(['capture', 'captureImmediate'] as const)('%s property serialization', (method) => {
    it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
        ['nested nullable properties', nullableProperties, cleanedProperties],
        ['all-null properties', { test: null, missing: undefined }, {}],
    ])('omits null object members from %s without changing the input', async (_name, properties, expected) => {
        const received: CaptureV1Event[] = []
        const posthog = await createPostHog({
            remoteConfig: localRemoteConfig,
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
            fetch: async (_input, init) => {
                const { batch } = JSON.parse(String(init?.body)) as { batch: CaptureV1Event[] }
                received.push(...batch)
                return new Response('{"results":{"nullable-uuid":{"result":"ok"}}}', { status: 200 })
            },
        })
        const snapshot = structuredClone(properties)
        const observed: unknown[] = []
        requireInstalledExtension(posthog.analytics).onEvent(({ properties }) => observed.push(properties))
        try {
            const result = await requireInstalledExtension(posthog.analytics)[method](
                'Nullable Properties',
                properties,
                { uuid: 'nullable-uuid' }
            )
            if (method === 'captureImmediate') {
                expect(result).toMatchObject({ submitted: 1, notPersisted: 0, allPersisted: true })
            }
            await posthog.flush()

            expect(received).toHaveLength(1)
            expect(received[0]).toMatchObject({
                event: 'Nullable Properties',
                uuid: 'nullable-uuid',
                distinct_id: posthog.distinctId,
                session_id: posthog.session!.sessionId,
                window_id: posthog.session!.windowId,
            })
            const { $device_id, $groups, ...custom } = received[0]!.properties
            expect($device_id).toBe(posthog.deviceId)
            expect($groups).toEqual({})
            expect(custom).toEqual(expected)
            expect(properties).toStrictEqual(snapshot)
            expect(observed).toEqual([expect.objectContaining(JSON.parse(JSON.stringify(properties)))])
        } finally {
            await posthog.dispose()
        }
    })

    it('cleans properties introduced by dynamic enrichment and toJSON', async () => {
        const received: CaptureV1Event[] = []
        const posthog = await createPostHog({
            remoteConfig: localRemoteConfig,
            projectToken: 'ph_test',
            capturePageview: false,
            storage: false,
            navigator: false,
            extensions: [analytics({ flushAt: 100, flushInterval: 0 })],
            fetch: async (_input, init) => {
                const { batch } = JSON.parse(String(init?.body)) as { batch: CaptureV1Event[] }
                received.push(...batch)
                return new Response('{"results":{"nullable-uuid":{"result":"ok"}}}', { status: 200 })
            },
        })
        const toJSON = vi.fn(() => ({ drop: null, items: [null, { drop: null }], keep: true }))
        const enrich = vi.fn(() => ({ dynamicNull: null, dynamicObject: { drop: null } }))
        requireInstalledExtension(posthog.analytics).registerDynamicEventProperties(enrich)
        try {
            await requireInstalledExtension(posthog.analytics)[method](
                'Enriched Properties',
                { converted: { toJSON } },
                { uuid: 'nullable-uuid' }
            )
            await posthog.flush()

            expect(received).toHaveLength(1)
            const { $device_id: _deviceId, $groups: _groups, ...custom } = received[0]!.properties
            expect(custom).toEqual({ dynamicObject: {}, converted: { items: [null, {}], keep: true } })
            expect(toJSON).toHaveBeenCalledTimes(1)
            expect(enrich).toHaveBeenCalledTimes(1)
        } finally {
            await posthog.dispose()
        }
    })
})

describe('session layering measurements', () => {
    it('retains caller and protected metadata in the minimum measurement while allowing persistent defaults to shrink', () => {
        const snapshot = snapshotCaptureProperties(
            { fallback: 'large persistent default', explicit: 'persistent' },
            { dynamic: 'dynamic' },
            { explicit: 'caller' },
            {}
        )
        const metadata = { token: 'project', distinct_id: 'authoritative', $session_id: 'session' }
        expect(unavoidableProperties(snapshot, metadata)).toEqual({
            explicit: 'caller',
            dynamic: 'dynamic',
            ...metadata,
        })
        expect(
            applySessionProperties(snapshot, {
                fallback: 'small',
                explicit: 'session',
                dynamic: 'session',
                distinct_id: 'wrong',
            })
        ).toBe(true)
        expect({ ...snapshot.message, ...metadata }).toEqual({
            fallback: 'small',
            explicit: 'caller',
            dynamic: 'dynamic',
            ...metadata,
        })
    })

    it('omits root serializer functions while retaining session layering and minimum measurement', () => {
        const serialize = vi.fn(() => ({ entire: 'caller context' }))
        const snapshot = snapshotCaptureProperties({ fallback: true }, {}, { caller: true, toJSON: serialize }, {})
        expect(applySessionProperties(snapshot, { entire: 'session', fallback: false })).toBe(true)
        expect(snapshot.message).toEqual({ caller: true, entire: 'session', fallback: false })
        expect(unavoidableProperties(snapshot, { token: 'project' })).toEqual({ caller: true, token: 'project' })
        expect(serialize).not.toHaveBeenCalled()
    })
})
