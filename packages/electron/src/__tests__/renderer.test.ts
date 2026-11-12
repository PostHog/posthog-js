import { describe, expect, it, vi } from 'vitest'
import { PostHog } from '../renderer'
import { validateRequest, type Bridge, type State } from '../shared/protocol'

function harness() {
    let state: State = {
        revision: 1,
        flagRevision: 1,
        generation: 0,
        distinctId: 'anonymous',
        anonymousId: 'anonymous',
        sessionId: 'session',
        optedOut: false,
        featureFlags: { experiment: 'control', off: false },
        featureFlagPayloads: { experiment: { color: 'blue' } },
    }
    let notify: ((state: State) => void) | undefined
    const unsubscribe = vi.fn()
    const bridge: Bridge = {
        request: vi.fn(async (request) => {
            validateRequest(request)
            if (request.command.type === 'identify')
                state = {
                    ...state,
                    revision: state.revision + 1,
                    generation: state.generation + 1,
                    distinctId: request.command.distinctId,
                }
            return { ok: true as const, state }
        }),
        subscribe: (callback) => {
            notify = callback
            return unsubscribe
        },
    }
    const client = new PostHog(bridge)
    return {
        client,
        bridge,
        unsubscribe,
        broadcast: (next: Partial<State>) => {
            state = { ...state, ...next }
            notify?.(state)
        },
    }
}

describe('renderer facade', () => {
    it('retains the stable bridge sequence across disposal and failed requests, isolating independent bridges', async () => {
        const { client, bridge } = harness()
        await client.ready()
        vi.mocked(bridge.request).mockResolvedValueOnce({ ok: false, error: 'rejected by owner' })
        await expect(client.capture('rejected')).rejects.toThrow('rejected by owner')
        client.dispose()
        const replacement = new PostHog(bridge)
        await replacement.ready()
        await replacement.capture('after reinit')
        expect(vi.mocked(bridge.request).mock.calls.map(([request]) => request.sequence)).toEqual([1, 2, 3, 4])
        const independent = harness()
        await independent.client.ready()
        expect(vi.mocked(independent.bridge.request).mock.calls[0][0].sequence).toBe(1)
        replacement.dispose()
        independent.client.dispose()
    })

    it('coalesces repeated cached flag reads before IPC, including in-flight reads and ordinary state revisions', async () => {
        const { client, bridge, broadcast } = harness()
        await client.ready()
        for (let i = 0; i < 150; i++) {
            expect(client.getFeatureFlag('experiment')).toBe('control')
            expect(client.isFeatureEnabled('experiment')).toBe(true)
        }
        await client.flush()
        broadcast({ revision: 2 })
        client.getFeatureFlag('experiment')
        client.getFeatureFlag('off')
        client.isFeatureEnabled('off')
        await client.flush()
        expect(
            vi
                .mocked(bridge.request)
                .mock.calls.map(([request]) => request.command)
                .filter(({ type }) => type === 'flag')
        ).toEqual([
            { type: 'flag', key: 'experiment', value: 'control', flagRevision: 1 },
            { type: 'flag', key: 'off', value: false, flagRevision: 1 },
        ])
        client.dispose()
    })

    it('preserves tracking suppression without marking the flag as sent', async () => {
        const { client, bridge } = harness()
        await client.ready()
        expect(client.getFeatureFlag('experiment', { sendEvent: false })).toBe('control')
        expect(client.isFeatureEnabled('experiment', { sendEvent: false })).toBe(true)
        await client.flush()
        expect(vi.mocked(bridge.request).mock.calls.map(([request]) => request.command.type)).toEqual([
            'hello',
            'flush',
        ])
        client.getFeatureFlag('experiment')
        client.isFeatureEnabled('experiment')
        await client.flush()
        expect(
            vi.mocked(bridge.request).mock.calls.filter(([request]) => request.command.type === 'flag')
        ).toHaveLength(1)
        client.dispose()
    })

    it.each([
        ['identity generation', { generation: 1 }, { generation: 0 }],
        ['flag revision', { flagRevision: 2 }, { flagRevision: 1 }],
        ['session', { sessionId: 'next-session' }, { sessionId: 'session' }],
        ['consent', { optedOut: true }, { optedOut: false }],
    ] as const)(
        'clears flag-read coalescing on %s changes, including returning to an earlier context',
        async (_name, next, previous) => {
            const { client, bridge, broadcast } = harness()
            await client.ready()
            client.getFeatureFlag('experiment')
            await client.flush()
            broadcast({ ...next, revision: 2 })
            client.getFeatureFlag('experiment')
            client.isFeatureEnabled('experiment')
            await client.flush()
            expect(
                vi.mocked(bridge.request).mock.calls.filter(([request]) => request.command.type === 'flag')
            ).toHaveLength(2)
            broadcast({ ...previous, revision: 3 })
            client.getFeatureFlag('experiment')
            client.isFeatureEnabled('experiment')
            await client.flush()
            expect(
                vi.mocked(bridge.request).mock.calls.filter(([request]) => request.command.type === 'flag')
            ).toHaveLength(3)
            client.dispose()
        }
    )

    it('tracks distinct values for the same key without confusing false and string values', async () => {
        const { client, bridge, broadcast } = harness()
        await client.ready()
        for (const [index, value] of [false, 'false', false].entries()) {
            broadcast({ revision: index + 2, featureFlags: { experiment: value } })
            expect(client.getFeatureFlag('experiment')).toBe(value)
            await client.flush()
        }
        expect(
            vi
                .mocked(bridge.request)
                .mock.calls.map(([request]) => request.command)
                .filter(({ type }) => type === 'flag')
        ).toEqual([
            { type: 'flag', key: 'experiment', value: false, flagRevision: 1 },
            { type: 'flag', key: 'experiment', value: 'false', flagRevision: 1 },
        ])
        client.dispose()
    })

    it.each(['transport rejection', 'main rejection'] as const)(
        'allows retry after %s without duplicating in-flight reads',
        async (failure) => {
            const { client, bridge } = harness()
            await client.ready()
            let reject!: () => void
            vi.mocked(bridge.request).mockImplementationOnce(
                () =>
                    new Promise((resolve, rejectRequest) => {
                        reject = () =>
                            failure === 'transport rejection'
                                ? rejectRequest(new Error('unavailable'))
                                : resolve({ ok: false, error: 'unavailable' })
                    })
            )
            client.getFeatureFlag('experiment')
            await vi.waitFor(() => expect(reject).toBeTypeOf('function'))
            client.getFeatureFlag('experiment')
            client.isFeatureEnabled('experiment')
            expect(bridge.request).toHaveBeenCalledTimes(2)
            reject()
            await client.flush()
            client.getFeatureFlag('experiment')
            client.isFeatureEnabled('experiment')
            await client.flush()
            expect(
                vi.mocked(bridge.request).mock.calls.filter(([request]) => request.command.type === 'flag')
            ).toHaveLength(2)
            client.dispose()
        }
    )

    it('does not remove a new-context mark when an old-context request rejects', async () => {
        const { client, bridge, broadcast } = harness()
        await client.ready()
        let reject!: () => void
        vi.mocked(bridge.request).mockImplementationOnce(
            () =>
                new Promise((_resolve, rejectRequest) => {
                    reject = () => rejectRequest(new Error('stale identity'))
                })
        )
        client.getFeatureFlag('experiment')
        await vi.waitFor(() => expect(reject).toBeTypeOf('function'))
        broadcast({ revision: 2, generation: 1 })
        client.getFeatureFlag('experiment')
        reject()
        await client.flush()
        client.getFeatureFlag('experiment')
        await client.flush()
        expect(
            vi.mocked(bridge.request).mock.calls.filter(([request]) => request.command.type === 'flag')
        ).toHaveLength(2)
        client.dispose()
    })

    it('keeps flag-read coalescing local to each renderer client', async () => {
        const first = harness(),
            second = harness()
        await Promise.all([first.client.ready(), second.client.ready()])
        for (const { client } of [first, second]) {
            client.getFeatureFlag('experiment')
            client.getFeatureFlag('experiment')
        }
        await Promise.all([first.client.flush(), second.client.flush()])
        for (const { client, bridge } of [first, second]) {
            expect(
                vi.mocked(bridge.request).mock.calls.filter(([request]) => request.command.type === 'flag')
            ).toHaveLength(1)
            client.dispose()
        }
    })

    it.each(['capture', 'identify', 'register', 'group'] as const)(
        'normalizes optional and Date properties before bridging %s',
        async (operation) => {
            const { client, bridge } = harness()
            await client.ready()
            const date = new Date('2025-01-02T03:04:05.000Z')
            const properties = { absent: undefined, at: date, nested: { absent: undefined }, list: [undefined, date] }
            // JavaScript callers can supply values outside TypeScript's JSON property type.
            const args =
                operation === 'group'
                    ? ['team', 'alpha', properties]
                    : operation === 'register'
                      ? [properties]
                      : [operation === 'capture' ? 'dated' : 'alice', properties]
            await Reflect.apply(client[operation], client, args)
            const command = vi.mocked(bridge.request).mock.calls[1][0].command
            expect(command).toMatchObject({
                properties: { at: '2025-01-02T03:04:05.000Z', nested: {}, list: [null, '2025-01-02T03:04:05.000Z'] },
            })
            expect('properties' in command && Object.hasOwn(command.properties!, 'absent')).toBe(false)
            client.dispose()
        }
    )
    it('does not create a flag-exposure/state-subscription feedback loop', async () => {
        const { client, bridge } = harness()
        await client.ready()
        let changes = 0
        client.onStateChange(() => {
            if (++changes < 3) client.getFeatureFlag('experiment')
        })
        await client.flush()
        expect(changes).toBe(1)
        const commands = vi.mocked(bridge.request).mock.calls.map(([request]) => request.command)
        expect(commands).toContainEqual({ type: 'flag', key: 'experiment', value: 'control', flagRevision: 1 })
        client.dispose()
    })

    it('keeps result reads and bulk reads out of state-listener feedback loops', async () => {
        const { client, bridge } = harness()
        await client.ready()
        let changes = 0
        client.onStateChange(() => {
            if (++changes < 3) {
                client.getFeatureFlagResult('experiment')
                client.isFeatureEnabled('off')
                client.getAllFeatureFlags()
            }
        })
        await client.flush()
        expect(changes).toBe(1)
        expect(
            vi.mocked(bridge.request).mock.calls.filter(([request]) => request.command.type === 'flag')
        ).toHaveLength(2)
        client.dispose()
    })

    it('returns public errors as rejected promises and preserves command order after rejection', async () => {
        const { client, bridge } = harness()
        await client.ready()
        await expect(client.setPersonProperties({ invalid: () => {} } as any)).rejects.toThrow()
        vi.mocked(bridge.request).mockResolvedValueOnce({ ok: false, error: 'Invalid PostHog command' })
        await expect(client.alias('valid')).rejects.toThrow('Invalid PostHog command')
        await client.screen('Home')
        expect(vi.mocked(bridge.request).mock.calls.at(-1)?.[0].command).toEqual({ type: 'screen', name: 'Home' })
        client.dispose()
        await expect(client.setPersonPropertiesForFlags({ plan: 'pro' })).rejects.toThrow('disposed')
    })

    it('uses synchronized cached state and awaits ordered identity mutation', async () => {
        const { client, bridge } = harness()
        expect(client.hasOptedOutCapturing()).toBe(true)
        await client.ready()
        expect(client.getDistinctId()).toBe('anonymous')
        expect(client.getFeatureFlag('experiment', { sendEvent: false })).toBe('control')
        await client.identify('alice')
        await client.capture('clicked')
        expect(client.getDistinctId()).toBe('alice')
        const calls = vi.mocked(bridge.request).mock.calls.map(([value]) => value)
        expect(calls.map((value) => value.sequence)).toEqual([1, 2, 3])
        expect(calls[2].generation).toBe(1)
        client.dispose()
    })
    it('ignores old snapshots and isolates mutable payloads', async () => {
        const { client, broadcast } = harness()
        await client.ready()
        broadcast({ revision: 4, distinctId: 'new' })
        broadcast({ revision: 2, distinctId: 'old' })
        expect(client.getDistinctId()).toBe('new')
        const payload = client.getFeatureFlagPayload('experiment') as { color: string }
        payload.color = 'red'
        expect(client.getFeatureFlagPayload('experiment')).toEqual({ color: 'blue' })
        client.dispose()
    })
    it('does not bridge captures or exception data while opted out', async () => {
        const { client, bridge, broadcast } = harness()
        await client.ready()
        broadcast({ optedOut: true, revision: 2 })
        await client.capture('secret', { secret: 'private' })
        await client.captureException(new Error('secret'))
        await client.group('organization', 'secret', { secret: 'private' })
        expect(bridge.request).toHaveBeenCalledTimes(1)
        client.dispose()
    })
    it('serializes real exception details before structured clone and cleans subscriptions', async () => {
        const { client, bridge, unsubscribe } = harness()
        await client.ready()
        await client.captureException(new TypeError('boom'), { area: 'settings' })
        const command = vi.mocked(bridge.request).mock.calls[1][0].command
        expect(command.type).toBe('exception')
        expect(command).toMatchObject({
            properties: {
                area: 'settings',
                $exception_list: [{ type: 'TypeError', value: 'boom', mechanism: { handled: true } }],
            },
        })
        client.dispose()
        client.dispose()
        expect(unsubscribe).toHaveBeenCalledTimes(1)
        await expect(client.reset()).rejects.toThrow('disposed')
    })
})
