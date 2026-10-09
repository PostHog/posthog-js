import type { MockInstance } from 'vitest'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { PostHog } from '../posthog-core'
import { AutocaptureExtension } from '../extension-tokens'
import { AutocaptureConfig, CaptureResult } from '../types'
import { createPosthogInstance } from './helpers/posthog-instance'

type ValueControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

function commit(element: ValueControl, value: string): void {
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

describe('autocapture input values', () => {
    let posthog: PostHog
    let capture: MockInstance<Parameters<PostHog['capture']>, ReturnType<PostHog['capture']>>

    beforeEach(async () => {
        posthog = await createPosthogInstance(undefined, { capture_pageview: false, autocapture: true })
        capture = vi.spyOn(posthog, 'capture')
    })

    afterEach(async () => {
        await posthog.shutdown()
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    function field(html = '<input id="message" />'): ValueControl {
        document.body.innerHTML = html
        return document.body.firstElementChild as ValueControl
    }

    function configure(config: AutocaptureConfig): void {
        posthog.set_config({ autocapture: config })
    }

    it('captures committed changes immediately without values by default', () => {
        const input = field()
        input.value = 'first edit'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        expect(capture).not.toHaveBeenCalled()
        commit(input, 'final value')
        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture.mock.calls[0][1]).toMatchObject({ $event_type: 'change' })
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
    })

    it.each([
        ['<input data-ph-capture-value />', 'test value'],
        ['<input type="search" data-ph-capture-value />', 'test value'],
        ['<input type="email" data-ph-capture-value />', 'user@example.test'],
        ['<input type="tel" data-ph-capture-value />', '123456'],
        ['<input type="url" data-ph-capture-value />', 'https://example.test'],
        ['<input type="number" data-ph-capture-value />', '123'],
        ['<input type="date" data-ph-capture-value />', '2026-01-02'],
        ['<input type="datetime-local" data-ph-capture-value />', '2026-01-02T03:04'],
        ['<input type="month" data-ph-capture-value />', '2026-01'],
        ['<input type="week" data-ph-capture-value />', '2026-W02'],
        ['<input type="time" data-ph-capture-value />', '03:04'],
        ['<input type="range" data-ph-capture-value />', '42'],
        ['<input type="color" data-ph-capture-value />', '#ff0000'],
        ['<input type="radio" data-ph-capture-value />', 'option-value'],
        ['<textarea data-ph-capture-value></textarea>', 'test value'],
        ['<select data-ph-capture-value><option value="option-value">Friendly label</option></select>', 'option-value'],
    ])('captures opted-in string values on %s', (html, value) => {
        const element = field(html)
        commit(element, value)
        expect(capture).toHaveBeenCalledTimes(1)
        const props = capture.mock.calls[0][1]!
        expect(props).toMatchObject({ $event_type: 'change', $input_value: value })
        expect(props.$elements_chain).not.toContain(value)
        expect(JSON.stringify(props.$elements)).not.toContain(value)
    })

    it.each(['password', 'hidden', 'file', 'checkbox', 'button', 'submit', 'reset', 'image'])(
        'does not enrich excluded %s inputs, even with explicit opt-in',
        (type) => {
            const element = field(`<input type="${type}" class="ph-include" data-ph-capture-value />`)
            element.dispatchEvent(new Event('change', { bubbles: true }))
            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
        }
    )

    it('leaves multi-select native changes unchanged', () => {
        const element = field(
            '<select multiple data-ph-capture-value><option selected>first</option><option selected>second</option></select>'
        )
        element.dispatchEvent(new Event('change', { bubbles: true }))
        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
    })

    it('does not enrich click or submit events', () => {
        const input = field('<input data-ph-capture-value />')
        input.dispatchEvent(new Event('click', { bubbles: true }))
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
        const form = field('<form data-ph-capture-value><input value="private value" /></form>')
        form.dispatchEvent(new Event('submit', { bubbles: true }))
        expect(capture.mock.calls[1][1]).not.toHaveProperty('$input_value')
    })

    it('matches custom selectors on the field, not its ancestors', () => {
        configure({ capture_value_css_selector_allowlist: ['.capture-value', '[data-custom]'] })
        document.body.innerHTML = '<div class="capture-value"><input /></div><input data-custom />'
        const inputs = document.querySelectorAll('input')
        commit(inputs[0], 'not opted in')
        commit(inputs[1], 'opted in')
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
        expect(capture.mock.calls[1][1]).toHaveProperty('$input_value', 'opted in')
    })

    it('uses the predicate to opt a field into value capture', () => {
        const predicate = vi.fn((element: Element) => element.id === 'message')
        configure({ capture_value_css_selector_allowlist: predicate })
        commit(field(), 'value')
        expect(predicate).toHaveBeenCalledWith(document.querySelector('input'))
        expect(capture.mock.calls[0][1]).toHaveProperty('$input_value', 'value')
    })

    it.each([[], () => false])('does not capture values when the opt-in does not match: %s', (allowlist) => {
        configure({ capture_value_css_selector_allowlist: allowlist })
        commit(field('<input data-ph-capture-value />'), 'value')
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
    })

    it('refreshes the opt-in configuration', () => {
        const input = field('<input data-ph-capture-value />')
        configure({ capture_value_css_selector_allowlist: [] })
        commit(input, 'first')
        configure({})
        commit(input, 'second')
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
        expect(capture.mock.calls[1][1]).toHaveProperty('$input_value', 'second')
    })

    it.each(['', '🙂', '4111111111111111'])('captures the exact opted-in string value: %s', (value) => {
        commit(field('<input data-ph-capture-value />'), value)
        expect(capture.mock.calls[0][1]).toMatchObject({ $input_value: value })
    })

    it('respects mask_all_text', () => {
        posthog.set_config({ mask_all_text: true })
        commit(field('<input data-ph-capture-value />'), 'value')
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
    })

    it.each(['class="ph-sensitive"', 'name="creditcard"'])(
        'omits value properties for sensitive fields: %s',
        (attributes) => {
            commit(field(`<input ${attributes} data-ph-capture-value />`), 'private value')
            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
        }
    )

    it.each(['ph-no-capture', 'ph-no-autocapture', 'custom-exclusion'])(
        'preserves ancestor exclusion before a page reparents the field on change: %s',
        (className) => {
            if (className === 'custom-exclusion') configure({ css_selector_ignorelist: ['.custom-exclusion'] })
            document.body.innerHTML = `<div class="${className}"><input data-ph-capture-value /></div>`
            const input = document.querySelector('input')!
            addEventListener(input, 'change', () => document.body.appendChild(input))
            commit(input, 'private value')
            expect(input.parentElement).toBe(document.body)
            expect(capture).not.toHaveBeenCalled()
        }
    )

    it('preserves ancestor sensitivity before a page reparents the field on change', () => {
        document.body.innerHTML = '<div class="ph-sensitive"><input data-ph-capture-value /></div>'
        const input = document.querySelector('input')!
        addEventListener(input, 'change', () => document.body.appendChild(input))
        commit(input, 'private value')
        expect(input.parentElement).toBe(document.body)
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
        commit(input, 'fresh value')
        expect(capture.mock.calls[1][1]).toMatchObject({ $input_value: 'fresh value' })
    })

    it.each(['none', 'input', 'host', 'outer'])('checks sensitivity across shadow ancestry: %s', (location) => {
        document.body.innerHTML = '<div id="outer"><div id="host"></div></div>'
        const host = document.querySelector('#host')!
        const root = host.attachShadow({ mode: 'open' })
        root.innerHTML = '<input id="shadow-field" data-ph-capture-value />'
        const input = root.querySelector('input')!
        const sensitive = location === 'input' ? input : location === 'host' ? host : document.querySelector('#outer')!
        if (location !== 'none') sensitive.className = 'ph-sensitive'
        commit(input, 'private value')
        expect(capture).toHaveBeenCalledTimes(1)
        if (location === 'none') {
            expect(capture.mock.calls[0][1]).toMatchObject({ $input_value: 'private value' })
        } else {
            expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
        }
    })

    it('respects sensitive descendants in a select', () => {
        commit(
            field('<select data-ph-capture-value><option class="ph-sensitive" value="private">label</option></select>'),
            'private'
        )
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$input_value')
    })

    it.each([
        { dom_event_allowlist: ['click'] },
        { url_allowlist: ['https://another-site.example'] },
        { url_ignorelist: ['http://localhost'] },
        { css_selector_ignorelist: ['input'] },
        { css_selector_allowlist: ['button'] },
        { element_allowlist: ['button'] },
    ] as AutocaptureConfig[])('respects existing autocapture filtering: %s', (config) => {
        configure(config)
        commit(field('<input data-ph-capture-value />'), 'private value')
        expect(capture).not.toHaveBeenCalled()
    })

    it('respects autocapture disablement and disposal', () => {
        const input = field('<input data-ph-capture-value />')
        posthog.set_config({ autocapture: false })
        commit(input, 'disabled')
        expect(capture).not.toHaveBeenCalled()
        posthog.set_config({ autocapture: true })
        posthog.getExtension(AutocaptureExtension)?.dispose()
        commit(input, 'disposed')
        expect(capture).not.toHaveBeenCalled()
    })

    it('respects capture opt-out', () => {
        const beforeSend = vi.fn((event: CaptureResult | null) => event)
        posthog.set_config({ before_send: beforeSend })
        posthog.opt_out_capturing()
        commit(field('<input data-ph-capture-value />'), 'private value')
        expect(beforeSend).not.toHaveBeenCalled()
    })

    it('allows before_send to redact the value or drop the event', () => {
        const captured: CaptureResult[] = []
        const beforeSend = vi.fn((event: CaptureResult | null) => {
            if (event?.event === '$autocapture') {
                expect(event.properties.$input_value).toBe('private value')
                delete event.properties.$input_value
                captured.push(event)
                return null
            }
            return event
        })
        posthog.set_config({ before_send: beforeSend })
        commit(field('<input data-ph-capture-value />'), 'private value')
        expect(captured).toHaveLength(1)
        expect(captured[0].properties).not.toHaveProperty('$input_value')
        expect(captured[0].properties.$elements_chain).not.toContain('private value')
    })
})
