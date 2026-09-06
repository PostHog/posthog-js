import { Autocapture } from '../autocapture'
import type { AutocaptureConfig } from '../autocapture-config'

// jsdom 16 has no PointerEvent; retain pointer identity on its MouseEvent implementation.
function pointer(target: Element, type: string, init: Partial<PointerEvent> = {}) {
    const event = new MouseEvent(type, { bubbles: true, clientX: 20, clientY: 20, detail: 1, ...init })
    Object.defineProperties(event, {
        pointerId: { value: init.pointerId ?? 1 },
        isPrimary: { value: init.isPrimary ?? true },
        pointerType: { value: init.pointerType ?? 'mouse' },
    })
    target.dispatchEvent(event)
}

describe('Autocapture click targets', () => {
    let extension: Autocapture
    let config: Partial<AutocaptureConfig>
    let capture: ReturnType<typeof vi.fn>
    let distinctId: string

    beforeEach(() => {
        config = { enabled: true, remoteRequestsDisabled: true }
        distinctId = 'before-reset'
        capture = vi.fn().mockResolvedValue(undefined)
        extension = new Autocapture({ refresh: (target) => Object.assign(target, config) })
        extension.setup({
            get distinctId() {
                return distinctId
            },
            capture,
            kv: { get: vi.fn(), set: vi.fn() },
            onRemoteConfig: () => ({ dispose: vi.fn() }),
        } as any)
        document.body.innerHTML = '<button><span>Actions</span></button>'
    })

    afterEach(() => {
        extension.dispose()
        document.body.innerHTML = ''
        for (const root of [document.documentElement, document.body]) {
            root.removeAttribute('class')
            root.removeAttribute('data-ph-no-autocapture')
        }
    })

    const span = () => document.querySelector('span')!
    const root = () => document.documentElement
    const dropdownClick = (init: Partial<PointerEvent> = {}) => {
        pointer(span(), 'pointerdown', init)
        pointer(root(), 'pointerup', init)
        pointer(root(), 'click', init)
    }

    it.each(['mouse', 'touch', 'pen'])('recovers a Radix-style root-retargeted %s click once', (pointerType) => {
        dropdownClick({ pointerType, detail: pointerType === 'mouse' ? 1 : 0 })
        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture).toHaveBeenCalledWith(
            '$autocapture',
            expect.objectContaining({ $event_type: 'click', $el_text: 'Actions' })
        )
    })

    it('does not duplicate ordinary pointer clicks', () => {
        pointer(span(), 'pointerdown')
        pointer(span(), 'pointerup')
        pointer(span(), 'click')
        expect(capture).toHaveBeenCalledTimes(1)
    })

    it('does not reuse a consumed pointer origin', () => {
        dropdownClick()
        pointer(root(), 'click')
        expect(capture).toHaveBeenCalledTimes(1)
    })

    it('does not emit on pointerdown alone', () => {
        pointer(span(), 'pointerdown')
        expect(capture).not.toHaveBeenCalled()
    })

    it.each(['pointercancel', 'drag', 'secondary', 'non-primary', 'different-pointer', 'disabled', 'disposed'])(
        'does not recover a %s gesture',
        (scenario) => {
            pointer(span(), 'pointerdown', {
                button: scenario === 'secondary' ? 2 : 0,
                isPrimary: scenario !== 'non-primary',
            })
            if (scenario === 'pointercancel') pointer(root(), 'pointercancel')
            if (scenario === 'drag') pointer(root(), 'pointermove', { clientX: 80 })
            if (scenario === 'disabled') config.enabled = false
            if (scenario === 'disposed') extension.dispose()
            pointer(root(), 'pointerup')
            pointer(root(), 'click', { pointerId: scenario === 'different-pointer' ? 2 : 1 })
            expect(capture).not.toHaveBeenCalled()
        }
    )

    it.each(['blur', 'reset', 'disable-reenable', 'server-opt-out', 'detached'])(
        'clears or rejects a pending target after %s',
        (scenario) => {
            pointer(span(), 'pointerdown')
            if (scenario === 'blur') window.dispatchEvent(new Event('blur'))
            if (scenario === 'reset') distinctId = 'after-reset'
            if (scenario === 'disable-reenable') {
                config.enabled = false
                extension.startIfEnabled()
                config.enabled = true
                extension.startIfEnabled()
            }
            if (scenario === 'server-opt-out') {
                extension.onRemoteConfig({ ok: true, config: { autocapture_opt_out: true } } as any)
                extension.onRemoteConfig({ ok: true, config: { autocapture_opt_out: false } } as any)
            }
            if (scenario === 'detached') document.querySelector('button')!.remove()
            pointer(root(), 'pointerup')
            pointer(root(), 'click')
            expect(capture).not.toHaveBeenCalled()
        }
    )

    it('does not borrow a pointer target for keyboard or legacy MouseEvent clicks', () => {
        pointer(span(), 'pointerdown')
        pointer(root(), 'pointerup')
        root().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        expect(capture).not.toHaveBeenCalled()
        document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
        expect(capture).toHaveBeenCalledTimes(1)
    })

    it('expires a released pointer before an unrelated later click', async () => {
        pointer(span(), 'pointerdown')
        pointer(root(), 'pointerup')
        await new Promise((resolve) => setTimeout(resolve, 10))
        pointer(root(), 'click')
        expect(capture).not.toHaveBeenCalled()
    })

    it.each(['ph-no-capture', 'ignored'])('retains %s on the recovered pointer origin', (className) => {
        config.css_selector_ignorelist = ['.ignored']
        span().className = className
        dropdownClick()
        expect(capture).not.toHaveBeenCalled()
    })

    describe.each(['html', 'body'])('retargeted %s privacy', (tag) => {
        it.each(['ph-no-capture', 'ph-sensitive', 'ph-no-autocapture', 'ignored'])(
            'does not recover clicks through %s',
            (className) => {
                if (className === 'ignored') config.css_selector_ignorelist = ['.ignored']
                const target = document.querySelector(tag)!
                target.classList.add(className)
                pointer(span(), 'pointerdown')
                pointer(target, 'pointerup')
                pointer(target, 'click')
                expect(capture).not.toHaveBeenCalled()
            }
        )

        it('respects the default data attribute opt-out', () => {
            document.querySelector(tag)!.setAttribute('data-ph-no-autocapture', '')
            dropdownClick()
            expect(capture).not.toHaveBeenCalled()
        })
    })

    it('ignores invalid selectors without bypassing valid root exclusions', () => {
        config.css_selector_ignorelist = ['[']
        dropdownClick()
        expect(capture).toHaveBeenCalledTimes(1)
        capture.mockClear()
        config.css_selector_ignorelist = ['[', 'html']
        dropdownClick()
        expect(capture).not.toHaveBeenCalled()
    })

    it('respects masking and event allowlists when recovering a click', () => {
        config.maskAllText = true
        config.maskAllElementAttributes = true
        dropdownClick()
        expect(capture.mock.calls[0][1]).not.toHaveProperty('$el_text')
        expect(capture.mock.calls[0][1].$elements_chain).not.toContain('Actions')
        capture.mockClear()
        config.dom_event_allowlist = ['change']
        dropdownClick()
        expect(capture).not.toHaveBeenCalled()
    })

    describe('nested SVG attribution', () => {
        beforeEach(() => {
            document.body.innerHTML =
                '<button><span><svg><g><path /></g></svg></span><span>Toggle Theme</span></button>'
        })
        const clickIcon = () => pointer(document.querySelector('path')!, 'click')

        it.each(['button', 'a'])('attributes nested SVG clicks to the enclosing %s', (tag) => {
            if (tag === 'a') document.body.innerHTML = document.body.innerHTML.replace(/button/g, 'a')
            clickIcon()
            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture.mock.calls[0][1].$elements[0].tag_name).toBe(tag)
            expect(capture.mock.calls[0][1].$el_text).toBe('Toggle Theme')
        })

        it.each(['path', 'g', 'svg', 'span'])('retains opt-outs on the original %s path', (tag) => {
            document.querySelector(tag)!.classList.add('ph-no-capture')
            clickIcon()
            expect(capture).not.toHaveBeenCalled()
        })

        it('retains selectors on the original SVG path', () => {
            config.css_selector_allowlist = ['path']
            config.element_allowlist = ['path']
            clickIcon()
            expect(capture).toHaveBeenCalledTimes(1)
            capture.mockClear()
            config.css_selector_ignorelist = ['g']
            clickIcon()
            expect(capture).not.toHaveBeenCalled()
        })

        it('does not expose parent text when the clicked SVG is sensitive', () => {
            document.querySelector('svg')!.classList.add('ph-sensitive')
            clickIcon()
            expect(capture.mock.calls[0][1]).not.toHaveProperty('$el_text')
        })

        describe.each(['button', 'a'])('enclosing %s', (tag) => {
            beforeEach(() => {
                if (tag === 'a') document.body.innerHTML = document.body.innerHTML.replace(/button/g, 'a')
            })

            it.each([
                ['contenteditable', 'true'],
                ['name', 'password'],
                ['id', 'credit-card'],
            ])('does not expose nested text when the control has sensitive %s', (attribute, value) => {
                document.querySelector(tag)!.setAttribute(attribute, value)
                clickIcon()
                expect(capture).toHaveBeenCalledTimes(1)
                const props = capture.mock.calls[0][1]
                expect(props).not.toHaveProperty('$el_text')
                expect(props.$elements_chain).not.toContain('Toggle Theme')
                expect(props.$elements.every((element: Record<string, unknown>) => !element.$el_text)).toBe(true)
            })

            it('matches watched control selectors while retaining SVG selectors without duplicates', () => {
                extension.setElementSelectors(new Set([tag, 'path', `${tag}, path`, '.unrelated']))
                clickIcon()
                expect(capture).toHaveBeenCalledTimes(1)
                const selectors = capture.mock.calls[0][1].$element_selectors
                expect(selectors).toContain(tag)
                expect(selectors).toContain('path')
                expect(selectors.filter((selector: string) => selector === `${tag}, path`)).toHaveLength(1)
                expect(selectors).toHaveLength(3)
            })
        })

        it('respects global text and attribute masking', () => {
            config.maskAllText = true
            config.maskAllElementAttributes = true
            clickIcon()
            expect(capture.mock.calls[0][1]).not.toHaveProperty('$el_text')
            expect(capture.mock.calls[0][1].$elements[0]).toEqual({ tag_name: 'button', nth_child: 1, nth_of_type: 1 })
        })

        it('leaves standalone SVG targets unchanged', () => {
            document.body.innerHTML = '<svg style="cursor:pointer"><path style="cursor:pointer" /></svg>'
            clickIcon()
            expect(capture.mock.calls[0][1].$elements[0].tag_name).toBe('path')
        })
    })
})
