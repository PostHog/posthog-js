// @vitest-environment jsdom
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { Client } from '@posthog/browser-common'
import type { AutocaptureClient } from '@posthog/browser-common/autocapture'
import { init, PostHog, type RendererOptions } from '../renderer'
import { BRIDGE_KEY, type Bridge, type Request, type State } from '../shared/protocol'

const clients: PostHog[] = []
afterEach(() => {
    for (const client of clients.splice(0)) client.dispose()
    document.body.innerHTML = ''
    delete (globalThis as any)[BRIDGE_KEY]
})

function harness(
    options: RendererOptions = { autocapture: true },
    remote: State['autocapture'] = { status: 'pending' }
) {
    let state: State = {
        revision: 1,
        generation: 0,
        flagRevision: 0,
        distinctId: 'anon',
        anonymousId: 'anon',
        sessionId: 'session',
        optedOut: false,
        featureFlags: {},
        featureFlagPayloads: {},
        autocapture: remote,
    }
    let notify: ((state: State) => void) | undefined
    const requests: Request[] = []
    const broadcast = (next: Partial<State>) => {
        state = { ...state, ...next, revision: state.revision + 1 }
        notify?.(state)
    }
    const bridge: Bridge = {
        request: vi.fn(async (request) => {
            requests.push(structuredClone(request))
            if (request.command.type === 'optOut') broadcast({ optedOut: true, generation: state.generation + 1 })
            if (request.command.type === 'optIn') broadcast({ optedOut: false })
            if (request.command.type === 'reset')
                broadcast({ generation: state.generation + 1, distinctId: 'reset-anon' })
            return { ok: true as const, state }
        }),
        subscribe: (listener) => {
            notify = listener
            return () => {
                notify = undefined
            }
        },
    }
    const client = new PostHog(bridge, options)
    clients.push(client)
    const captures = () => requests.filter((request) => request.command.type === 'capture')
    document.body.innerHTML = '<button id="safe">Save</button><input id="input"><form id="form"></form>'
    const click = () => document.querySelector<HTMLButtonElement>('#safe')!.click()
    return { client, bridge, broadcast, requests, captures, click }
}

function observeAttributes(element: Element) {
    const getter = Object.getOwnPropertyDescriptor(Element.prototype, 'attributes')!.get!
    const reads = vi.fn(() => getter.call(element))
    Object.defineProperty(element, 'attributes', { configurable: true, get: reads })
    return { reads, restore: () => Reflect.deleteProperty(element, 'attributes') }
}

const enabled = { status: 'loaded', autocapture_opt_out: false, elementsChainAsString: true } as const

describe('Electron DOM autocapture', () => {
    it('keeps full browser extension clients structurally compatible', () => {
        expectTypeOf<Client>().toMatchTypeOf<AutocaptureClient>()
    })

    it('is off by default and init is idempotent when explicitly enabled', async () => {
        const off = harness({}, enabled)
        await off.client.ready()
        off.click()
        await off.client.flush()
        expect(off.captures()).toHaveLength(0)
        expect(off.requests.some((request) => request.command.type === 'loadAutocaptureConfig')).toBe(false)
        off.client.dispose()
        ;(globalThis as any)[BRIDGE_KEY] = off.bridge
        const client = await init({ autocapture: true })
        clients.push(client)
        expect(await init({ autocapture: true })).toBe(client)
        off.click()
        await client.flush()
        expect(off.captures()).toHaveLength(1)
    })

    it('waits for authoritative config, then routes click/change/submit through capture in order', async () => {
        const h = harness()
        await h.client.ready()
        h.click()
        await h.client.flush()
        expect(h.captures()).toHaveLength(0)
        h.broadcast({ autocapture: enabled })
        h.click()
        document.querySelector('#input')!.dispatchEvent(new Event('change', { bubbles: true }))
        document.querySelector('#form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await h.client.flush()
        expect(h.captures().map((request) => request.command)).toMatchObject([
            {
                event: '$autocapture',
                properties: {
                    $event_type: 'click',
                    $el_text: 'Save',
                    $elements_chain: expect.stringContaining('button'),
                },
            },
            { event: '$autocapture', properties: { $event_type: 'change' } },
            { event: '$autocapture', properties: { $event_type: 'submit' } },
        ])
        expect(h.captures().every((request) => request.generation === 0)).toBe(true)
        expect(JSON.stringify(h.requests)).not.toMatch(/\$snapshot|rrweb|recorder/)
    })

    it.each([
        { status: 'failed' as const },
        { status: 'loaded' as const },
        { status: 'failed' as const, autocapture_opt_out: true },
        { status: 'loaded' as const, autocapture_opt_out: true },
        { status: 'pending' as const, autocapture_opt_out: false },
    ])('fails closed for config %j before serializing DOM', async (remote) => {
        const h = harness({ autocapture: true }, remote)
        await h.client.ready()
        const attributes = observeAttributes(document.querySelector('#safe')!)
        h.click()
        await h.client.flush()
        expect(h.captures()).toHaveLength(0)
        expect(attributes.reads).not.toHaveBeenCalled()
    })

    it('allows last-known enablement after failure, but explicit config disable never overrides a known kill switch', async () => {
        const h = harness({ autocapture: true }, { ...enabled, status: 'failed' })
        await h.client.ready()
        h.click()
        await h.client.flush()
        expect(h.captures()).toHaveLength(1)
        h.broadcast({ autocapture: { status: 'loaded', autocapture_opt_out: true } })
        h.broadcast({ autocapture: { status: 'disabled', autocapture_opt_out: true } })
        h.click()
        await h.client.flush()
        expect(h.captures()).toHaveLength(1)
    })

    it('uses local config only when main explicitly disables remote config', async () => {
        const h = harness({ autocapture: true }, { status: 'disabled' })
        await h.client.ready()
        h.click()
        await h.client.flush()
        expect(h.captures()).toHaveLength(1)
        expect(h.requests.some((request) => request.command.type === 'loadAutocaptureConfig')).toBe(false)
    })

    it('stops before DOM serialization on immediate opt-out, restarts once, and preserves generation across reset', async () => {
        const h = harness({ autocapture: true }, enabled)
        await h.client.ready()
        h.click()
        await h.client.flush()
        const out = h.client.optOut()
        const attributes = observeAttributes(document.querySelector('#safe')!)
        h.click()
        expect(attributes.reads).not.toHaveBeenCalled()
        attributes.restore()
        await out
        await h.client.optIn()
        h.click()
        await h.client.flush()
        await h.client.reset()
        h.click()
        await h.client.flush()
        expect(h.captures().map((request) => request.generation)).toEqual([0, 1, 2])
        h.client.dispose()
        h.client.dispose()
        h.click()
        await Promise.resolve()
        expect(h.captures()).toHaveLength(3)
    })

    it('uses shared masking and sensitive-field exclusions before IPC', async () => {
        const h = harness({ autocapture: true }, enabled)
        await h.client.ready()
        document.body.innerHTML = `
          <div class="ph-no-capture"><button id="blocked">DOM_PRIVATE_CANARY</button></div>
          <div class="ph-sensitive"><button id="sensitive">DOM_PRIVATE_CANARY</button></div>
          <input id="password" type="password" value="DOM_PRIVATE_CANARY">
          <input id="email" name="email" value="private@example.com">
          <input id="plain" value="DOM_PRIVATE_CANARY">
          <form id="form"><input value="DOM_PRIVATE_CANARY"></form>`
        for (const id of ['blocked', 'sensitive']) document.querySelector<HTMLButtonElement>('#' + id)!.click()
        for (const id of ['password', 'email', 'plain']) {
            const input = document.querySelector<HTMLInputElement>('#' + id)!
            input.value = 'DOM_PRIVATE_CANARY'
            input.dispatchEvent(new Event('change', { bubbles: true }))
        }
        document.querySelector('#form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await h.client.flush()
        expect(JSON.stringify(h.requests)).not.toMatch(/DOM_PRIVATE_CANARY|private@example.com|\$input_value/)
        expect(h.captures().some((request) => JSON.stringify(request).includes('blocked'))).toBe(false)
    })

    it.each([
        { url_allowlist: ['never-match-this-url'] },
        { url_ignorelist: ['.*'] },
        { css_selector_ignorelist: ['#safe'] },
        { dom_event_allowlist: ['submit' as const] },
    ])('honors filters %j', async (autocapture) => {
        const h = harness({ autocapture }, enabled)
        await h.client.ready()
        h.click()
        await h.client.flush()
        expect(h.captures()).toHaveLength(0)
    })

    it('honors masking, event/selector filters, and reports rejected bridge captures without crashing', async () => {
        const onError = vi.fn()
        const h = harness(
            {
                autocapture: {
                    maskAllText: true,
                    maskAllElementAttributes: true,
                    dom_event_allowlist: ['click'],
                    css_selector_allowlist: ['#safe'],
                },
                onError,
            },
            enabled
        )
        await h.client.ready()
        h.click()
        await h.client.flush()
        expect(JSON.stringify(h.captures())).not.toContain('Save')
        expect(JSON.stringify(h.captures())).not.toContain('attr__id')
        h.broadcast({ revision: 20 })
        document.querySelector('#input')!.dispatchEvent(new Event('change', { bubbles: true }))
        vi.mocked(h.bridge.request).mockResolvedValueOnce({ ok: false, error: 'rejected' })
        h.click()
        await h.client.flush()
        expect(onError).toHaveBeenCalledOnce()
        expect(onError.mock.calls[0][0].message).toBe('rejected')
    })
})
