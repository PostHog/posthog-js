// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createElement, StrictMode, useEffect, useLayoutEffect, useState } from 'react'
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
        expect(h.flags()).toHaveLength(4)
        expect(h.flags().slice(2)).toEqual([
            expect.objectContaining({
                generation: 3,
                command: { type: 'flag', key: 'experiment', flagRevision: 8, value: false },
            }),
            expect.objectContaining({
                generation: 3,
                command: { type: 'flag', key: 'experiment', flagRevision: 8, value: false },
            }),
        ])
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
        expect(count).toBe(2)
        act(() => h.broadcast({ generation: 2, flagRevision: 3 }))
        await settle(h.client)
        expect(h.flags()).toHaveLength(count + 1)
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

    it.each(['unmount', 'update'] as const)(
        'does not expose an unrendered flag after a layout-effect broadcast and %s',
        async (action) => {
            const h = await harness()
            const rendered: (string | boolean | undefined)[] = []
            function Probe() {
                const variant = useFeatureFlagVariantKey('experiment')
                const enabled = useFeatureFlagEnabled('experiment')
                rendered.push(variant)
                return createElement('output', null, `${variant}:${enabled}`)
            }
            function LayoutUpdate() {
                const [mounted, setMounted] = useState(true)
                useLayoutEffect(() => {
                    h.broadcast({ featureFlags: { experiment: 'test' }, flagRevision: 2 })
                    if (action === 'unmount') setMounted(false)
                }, [])
                return mounted ? createElement(Probe) : null
            }
            const view = render(createElement(PostHogProvider, { client: h.client }, createElement(LayoutUpdate)))
            await settle(h.client)
            if (action === 'unmount') {
                expect(rendered).toEqual(['control'])
                expect(view.container.textContent).toBe('')
                expect(h.flags()).toEqual([])
            } else {
                expect(rendered).toContain('test')
                expect(view.container.textContent).toBe('test:true')
                expect(h.flags().map((request) => request.command)).toEqual([
                    { type: 'flag', key: 'experiment', flagRevision: 2, value: 'test' },
                ])
            }
        }
    )

    it.each([
        { name: 'object', payload: { color: 'blue' } },
        { name: 'array', payload: ['blue', false] },
    ])(
        'keeps $name payload references stable for consumer effects, rerenders and unrelated SDK state',
        async ({ payload }) => {
            const h = await harness({ featureFlagPayloads: { experiment: payload } })
            const effects: unknown[] = []
            let current: unknown
            function PayloadConsumer() {
                const value = useFeatureFlagPayload('experiment')
                const [config, setConfig] = useState<unknown>()
                current = value
                useEffect(() => {
                    effects.push(value)
                    // Bound a broken hook's feedback loop so the identity assertion can diagnose it.
                    if (effects.length < 5) setConfig(value)
                }, [value])
                return createElement('output', null, JSON.stringify(config))
            }
            const content = () => createElement(PostHogProvider, { client: h.client }, createElement(PayloadConsumer))
            const view = render(content())
            expect(view.container.textContent).toBe(JSON.stringify(payload))
            expect(effects).toHaveLength(1)
            const initial = current
            view.rerender(content())
            expect(current).toBe(initial)
            act(() => h.broadcast({ sessionId: 'another-session' }))
            expect(current).toBe(initial)
            expect(effects).toHaveLength(1)
            await settle(h.client)
            expect(h.flags()).toEqual([])
            act(() => h.broadcast({ flagRevision: 2, featureFlagPayloads: { experiment: { color: 'green' } } }))
            expect(current).toEqual({ color: 'green' })
            expect(current).not.toBe(initial)
            expect(effects).toHaveLength(2)
        }
    )

    it.each([{ generation: 1 }, { optedOut: true }])(
        'skips stale exposure when a layout effect changes authorization before unmount: %j',
        async (change) => {
            const h = await harness()
            function LayoutUnmount() {
                const [mounted, setMounted] = useState(true)
                useLayoutEffect(() => {
                    h.broadcast(change)
                    setMounted(false)
                }, [])
                return mounted ? createElement(Values) : null
            }
            render(createElement(PostHogProvider, { client: h.client }, createElement(LayoutUnmount)))
            await settle(h.client)
            expect(h.flags()).toEqual([])
        }
    )

    it('switches payload keys and clients without reusing an equal-revision snapshot', async () => {
        const first = await harness({ featureFlagPayloads: { experiment: { color: 'blue' }, off: [1, false] } })
        const second = await harness({ featureFlagPayloads: { experiment: { color: 'red' } } })
        let payload: unknown
        function Payload({ flag }: { flag: string }) {
            payload = useFeatureFlagPayload(flag)
            return null
        }
        const content = (client: PostHog, flag = 'experiment') =>
            createElement(PostHogProvider, { client }, createElement(Payload, { flag }))
        const view = render(content(first.client))
        expect(payload).toEqual({ color: 'blue' })
        view.rerender(content(first.client, 'off'))
        expect(payload).toEqual([1, false])
        view.rerender(content(second.client))
        expect(payload).toEqual({ color: 'red' })
        act(() => first.broadcast({ flagRevision: 2, featureFlagPayloads: {} }))
        expect(payload).toEqual({ color: 'red' })
        await settle(first.client)
        await settle(second.client)
        expect(first.flags()).toEqual([])
        expect(second.flags()).toEqual([])
    })

    it('does not clone renderer state on renders when the state revision is unchanged', async () => {
        const { client, broadcast } = await harness()
        const getState = vi.spyOn(client, 'getState')
        let rerender!: () => void
        function Parent() {
            const [, set] = useState(0)
            rerender = () => set((value) => value + 1)
            return createElement(PostHogProvider, { client }, createElement(Values))
        }
        render(createElement(Parent))
        getState.mockClear()
        for (let i = 0; i < 10; i++) act(() => rerender())
        expect(getState).not.toHaveBeenCalled()
        act(() => broadcast({ featureFlags: { experiment: 'test' }, flagRevision: 2 }))
        expect(screen.getByTestId('primary').textContent).toContain('"variant":"test"')
        const perBroadcast = getState.mock.calls.length
        getState.mockClear()
        for (let i = 0; i < 10; i++) act(() => rerender())
        expect(getState).not.toHaveBeenCalled()
        // Renderer listener fan-out only: the count must not scale with React renders.
        act(() => broadcast({ featureFlags: { experiment: 'control' }, flagRevision: 3 }))
        expect(getState.mock.calls.length).toBe(perBroadcast)
    })

    it('requires an explicit Electron provider', () => {
        expect(() => renderToString(createElement(Values))).toThrow('@posthog/electron/react PostHogProvider')
    })
})
