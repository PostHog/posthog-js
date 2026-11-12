// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createElement, StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { PostHog } from '../renderer'
import {
    PostHogProvider,
    usePostHog,
    useFeatureFlagEnabled,
    useFeatureFlagVariantKey,
    useFeatureFlagPayload,
} from '../react'
import type { Bridge, Request, State } from '../shared/protocol'

const clients: PostHog[] = []
afterEach(() => {
    cleanup()
    clients.splice(0).forEach((client) => client.dispose())
})

async function harness(initial: Partial<State> = {}) {
    let state: State = {
        revision: 1,
        generation: 0,
        flagRevision: 1,
        distinctId: 'anonymous',
        anonymousId: 'anonymous',
        sessionId: 'shared-session',
        optedOut: false,
        flagsLoaded: true,
        featureFlags: { experiment: 'control', off: false, on: true },
        featureFlagPayloads: { experiment: { color: 'blue' } },
        ...initial,
    }
    const listeners = new Set<(state: State) => void>()
    const requests: Request[] = []
    const bridge: Bridge = {
        request: async (request) => {
            requests.push(structuredClone(request))
            return { ok: true, state: structuredClone(state) }
        },
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
    const createClient = async (): Promise<PostHog> => {
        const client = new PostHog(bridge)
        clients.push(client)
        await client.ready()
        return client
    }
    const client = await createClient()
    return {
        client,
        requests,
        createClient,
        broadcast: (next: Partial<State>) => {
            state = { ...state, ...next, revision: state.revision + 1 }
            listeners.forEach((listener) => listener(structuredClone(state)))
        },
        flags: () => requests.filter((request) => request.command.type === 'flag'),
    }
}

function Values({ flag = 'experiment', window = 'primary' }: { flag?: string; window?: string }) {
    const client = usePostHog()
    const enabled = useFeatureFlagEnabled(flag)
    const variant = useFeatureFlagVariantKey(flag)
    const payload = useFeatureFlagPayload(flag)
    return createElement(
        'output',
        { 'data-testid': window },
        JSON.stringify({
            id: client.getDistinctId(),
            optedOut: client.hasOptedOutCapturing(),
            enabled,
            variant,
            payload,
        })
    )
}

function tree(client: PostHog, flag = 'experiment', window = 'primary') {
    return createElement(PostHogProvider, { client }, createElement(Values, { flag, window }))
}

function values(window = 'primary') {
    return JSON.parse(screen.getByTestId(window).textContent!)
}

async function settle(client: PostHog) {
    await act(async () => {
        await client.flush()
    })
}

describe('Electron React bindings with a real renderer facade', () => {
    it('reads initialized state without render-time exposure, and exposes only after commit', async () => {
        const h = await harness()
        const markup = renderToString(tree(h.client))
        expect(markup).toContain('control')
        await h.client.flush()
        expect(h.flags()).toEqual([])

        render(tree(h.client))
        await settle(h.client)
        expect(values()).toEqual({
            id: 'anonymous',
            optedOut: false,
            enabled: true,
            variant: 'control',
            payload: { color: 'blue' },
        })
        expect(h.flags().map((request) => request.command)).toEqual([
            { type: 'flag', key: 'experiment', flagRevision: 1, value: 'control' },
            { type: 'flag', key: 'experiment', flagRevision: 1, value: 'control' },
        ])
        expect(h.flags().every((request) => request.generation === 0)).toBe(true)
    })

    it('uses stable snapshots in StrictMode and removes subscriptions without disposing the caller client', async () => {
        const h = await harness()
        const unsubscribes: Mock<[], void>[] = []
        const onStateChange = h.client.onStateChange.bind(h.client)
        vi.spyOn(h.client, 'onStateChange').mockImplementation((callback) => {
            const unsubscribe = vi.fn(onStateChange(callback))
            unsubscribes.push(unsubscribe)
            return unsubscribe
        })
        const dispose = vi.spyOn(h.client, 'dispose')
        const view = render(createElement(StrictMode, null, tree(h.client)))
        await settle(h.client)
        const count = h.flags().length
        view.rerender(createElement(StrictMode, null, tree(h.client)))
        await settle(h.client)
        expect(h.flags()).toHaveLength(count)
        view.unmount()
        expect(unsubscribes.length).toBeGreaterThan(0)
        expect(unsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)
        expect(dispose).not.toHaveBeenCalled()
        act(() => h.broadcast({ featureFlags: { experiment: 'other' }, flagRevision: 2 }))
        await h.client.capture('still-owned-by-caller')
        expect(h.flags()).toHaveLength(count)
    })

    it('updates both windows on main flag, identity and consent broadcasts with main revision provenance', async () => {
        const h = await harness()
        const second = await h.createClient()
        render(createElement('div', null, tree(h.client), tree(second, 'experiment', 'secondary')))
        await settle(h.client)
        await settle(second)
        act(() =>
            h.broadcast({
                generation: 3,
                distinctId: 'alice',
                flagRevision: 8,
                optedOut: true,
                featureFlags: { experiment: false },
                featureFlagPayloads: {},
            })
        )
        expect(values()).toEqual({ id: 'alice', optedOut: true, enabled: false, variant: false, payload: null })
        expect(values('secondary')).toEqual(values())
        await settle(h.client)
        await settle(second)
        expect(
            h
                .flags()
                .slice(-4)
                .every(
                    (request) =>
                        request.generation === 3 &&
                        request.command.type === 'flag' &&
                        request.command.flagRevision === 8
                )
        ).toBe(true)
        // Consent is enforced by main, not by a separate React tracker or transport.
        act(() => h.broadcast({ optedOut: false }))
        await settle(h.client)
        expect(values().optedOut).toBe(false)
    })

    it('handles key and client switches immediately, including equal revision numbers', async () => {
        const first = await harness()
        const second = await harness({ distinctId: 'bob', featureFlags: { experiment: 'second' } })
        const seen: string[] = []
        function Probe() {
            seen.push(`${usePostHog().getDistinctId()}:${useFeatureFlagVariantKey('experiment')}`)
            return null
        }
        const view = render(tree(first.client))
        view.rerender(tree(first.client, 'off'))
        expect(values().variant).toBe(false)
        expect(values().enabled).toBe(false)
        view.rerender(createElement(PostHogProvider, { client: first.client }, createElement(Probe)))
        seen.length = 0
        view.rerender(createElement(PostHogProvider, { client: second.client }, createElement(Probe)))
        expect(seen).toEqual(['bob:second'])
        act(() => first.broadcast({ distinctId: 'stale', featureFlags: { experiment: 'stale' } }))
        expect(seen).toEqual(['bob:second'])
        await settle(first.client)
        await settle(second.client)
        expect(first.flags().some((request) => request.command.type === 'flag' && request.command.key === 'off')).toBe(
            true
        )
    })

    it('keeps payload-only reads non-exposing and responds to loaded-empty flag snapshots', async () => {
        const h = await harness({ flagsLoaded: false, featureFlags: {}, featureFlagPayloads: {} })
        function Payload() {
            return createElement('output', null, JSON.stringify(useFeatureFlagPayload('experiment')))
        }
        const view = render(createElement(PostHogProvider, { client: h.client }, createElement(Payload)))
        await settle(h.client)
        expect(h.flags()).toEqual([])
        act(() => h.broadcast({ flagsLoaded: true, flagRevision: 2 }))
        expect(view.container.textContent).toBe('null')
        await settle(h.client)
        expect(h.flags()).toEqual([])
        view.rerender(tree(h.client))
        expect(values().payload).toBeNull()
    })

    it('preserves renderer empty-variant and unknown semantics and exposes again on a new flag generation', async () => {
        const h = await harness({ flagsLoaded: false, featureFlags: {}, featureFlagPayloads: {} })
        render(tree(h.client))
        expect(values().variant).toBeUndefined()
        expect(values().enabled).toBeUndefined()
        await settle(h.client)
        act(() =>
            h.broadcast({
                flagsLoaded: true,
                generation: 1,
                flagRevision: 2,
                featureFlags: { experiment: '' },
                featureFlagPayloads: { experiment: false },
            })
        )
        expect(values().variant).toBe('')
        expect(values().enabled).toBe(false)
        expect(values().payload).toBe(false)
        await settle(h.client)
        const count = h.flags().length
        act(() => h.broadcast({ generation: 2, flagRevision: 3 }))
        await settle(h.client)
        expect(h.flags()).toHaveLength(count + 2)
        expect(h.flags().at(-1)).toMatchObject({
            generation: 2,
            command: { type: 'flag', flagRevision: 3, value: '' },
        })
    })

    it('stops renderer-driven React updates after client disposal', async () => {
        const h = await harness()
        render(tree(h.client))
        await settle(h.client)
        h.client.dispose()
        act(() => h.broadcast({ distinctId: 'ignored', featureFlags: { experiment: 'ignored' } }))
        expect(values().id).toBe('anonymous')
        expect(values().variant).toBe('control')
    })

    it('requires an explicit Electron provider', () => {
        expect(() => renderToString(createElement(Values))).toThrow('@posthog/electron/react PostHogProvider')
    })
})
