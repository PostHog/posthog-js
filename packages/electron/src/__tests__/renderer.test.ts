import { describe, expect, it, vi } from 'vitest'
import { PostHog } from '../renderer'
import type { Bridge, State } from '../shared/protocol'

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
