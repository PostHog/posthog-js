// @vitest-environment jsdom
import { Autocapture, autocapturePropertiesForElement, getPropertiesFromElement } from '../src/autocapture'
import { getSafeText, shouldCaptureElement, shouldCaptureDomEvent } from '../src/utils/autocapture-utils'
import { createTestClient } from './helpers/test-client'

const canary = 'COMPOSED_PRIVATE_CANARY'

describe('autocapture composed-tree privacy', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    it('does not read a private shadow link href', () => {
        const host = document.createElement('div')
        host.className = 'ph-sensitive'
        const link = document.createElement('a')
        link.href = '/private-destination'
        host.attachShadow({ mode: 'open' }).append(link)
        document.body.append(host)
        const read = vi.spyOn(link, 'getAttribute')
        autocapturePropertiesForElement(link, {
            e: new MouseEvent('click'),
            maskAllElementAttributes: false,
            maskAllText: false,
            elementsChainAsString: true,
            disableCaptureUrlHashes: false,
        })
        expect(read.mock.calls.filter(([name]) => name === 'href')).toHaveLength(0)
    })

    it('retains safe password metadata without capturing its value', () => {
        const input = document.createElement('input')
        input.type = 'password'
        input.id = 'password-control'
        input.name = 'password'
        input.value = canary
        document.body.append(input)
        const properties = getPropertiesFromElement(input, false, false, undefined)
        expect(properties).toMatchObject({ tag_name: 'input', attr__id: 'password-control', attr__name: 'password' })
        expect(JSON.stringify(properties)).not.toContain(canary)
    })

    it('does not inspect attributes when composed privacy ancestry is cyclic', () => {
        const first = document.createElement('button')
        const second = document.createElement('div')
        Object.defineProperty(first, 'assignedSlot', { value: second })
        Object.defineProperty(second, 'parentNode', { value: first })
        const read = vi.fn(() => {
            throw new Error('private attributes read')
        })
        Object.defineProperty(first, 'attributes', { get: read })
        expect(shouldCaptureElement(first)).toBe(false)
        expect(getPropertiesFromElement(first, false, false, undefined)).toMatchObject({ tag_name: 'button' })
        expect(read).not.toHaveBeenCalled()
    })

    it('applies selector exclusions across slots', () => {
        const host = document.createElement('div')
        const shadow = host.attachShadow({ mode: 'open' })
        shadow.innerHTML = '<div class="private-wrapper"><slot></slot></div>'
        const button = document.createElement('button')
        host.append(button)
        document.body.append(host)
        expect(
            shouldCaptureDomEvent(button, new MouseEvent('click'), { css_selector_ignorelist: ['.private-wrapper'] })
        ).toBe(false)
    })

    it.each(['light', 'shadow'])('does not inspect sensitive attributes through a %s ancestor', (boundary) => {
        const host = document.createElement('div')
        host.className = 'ph-sensitive'
        document.body.append(host)
        const button = document.createElement('button')
        button.className = 'ph-include structural'
        button.setAttribute('data-private', canary)
        if (boundary === 'shadow') host.attachShadow({ mode: 'open' }).append(button)
        else host.append(button)
        const getter = Object.getOwnPropertyDescriptor(Element.prototype, 'attributes')!.get!
        const read = vi.fn(() => getter.call(button))
        Object.defineProperty(button, 'attributes', { configurable: true, get: read })
        const properties = getPropertiesFromElement(button, false, false, undefined)
        expect(read).not.toHaveBeenCalled()
        expect(JSON.stringify(properties)).not.toContain(canary)
        expect(properties).toMatchObject({ tag_name: 'button', classes: ['ph-include', 'structural'], nth_child: 1 })
        host.className = 'ph-no-capture'
        expect(shouldCaptureElement(button)).toBe(false)
        host.className = ''
        expect(shouldCaptureElement(button)).toBe(true)
        expect(getPropertiesFromElement(button, false, false, undefined)['attr__data-private']).toBe(canary)
    })

    it.each([
        ['ph-sensitive', 'host'],
        ['ph-sensitive', 'slot'],
        ['ph-no-capture', 'host'],
        ['ph-no-capture', 'slot'],
    ])('honors %s on a %s before collecting text or attributes', (marker, boundary) => {
        const client = createTestClient()
        const extension = new Autocapture({
            refresh: (config) => Object.assign(config, { enabled: true, remoteRequestsDisabled: true }),
        })
        extension.setup(client)
        try {
            const host = document.createElement('div')
            const shadow = host.attachShadow({ mode: 'open' })
            document.body.append(host)
            let button: HTMLButtonElement
            if (boundary === 'host') {
                host.className = marker
                button = document.createElement('button')
                shadow.append(button)
            } else {
                shadow.innerHTML = `<div class="${marker}"><slot></slot></div>`
                button = document.createElement('button')
                host.append(button)
            }
            button.textContent = canary
            button.setAttribute('data-ph-capture-attribute-private', canary)
            expect(shouldCaptureElement(button), boundary).toBe(false)
            expect(getSafeText(button), boundary).toBe('')
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
            expect(JSON.stringify(client.capturedEvents), boundary).not.toContain(canary)
            if (marker === 'ph-no-capture') expect(client.capturedEvents, boundary).toHaveLength(0)
            host.remove()
            const safe = document.createElement('button')
            safe.textContent = 'Public control'
            document.body.append(safe)
            safe.click()
            expect(client.capturedEvents.at(-1)?.properties?.$el_text).toBe('Public control')
        } finally {
            extension.dispose()
            client.dispose()
        }
    })
})
