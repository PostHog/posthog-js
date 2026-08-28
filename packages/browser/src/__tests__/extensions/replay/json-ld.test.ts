import { sanitizeJsonLd, startJsonLdCapture } from '../../../extensions/replay/external/json-ld'
import jsonLdContract from '../../../../test-fixtures/json-ld-sanitization-v1.json'
import { addJsonLdContractTests } from './json-ld-contract'

function jsonLdScript(value: unknown): HTMLScriptElement {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(value)
    return script
}

async function deliverMutations(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe('JSON-LD replay capture', () => {
    afterEach(() => {
        document.body.replaceChildren()
    })

    addJsonLdContractTests(jsonLdContract, sanitizeJsonLd)

    it('keeps @id only when replay captures the matching DOM id', () => {
        document.body.innerHTML = `
            <div id="product-id"></div>
            <div class="ph-mask"><div id="masked-text-id"></div></div>
            <div class="ph-no-capture"><div id="blocked-id"></div></div>
        `
        const script = jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'Product',
            '@id': 'https://example.com/products/123#product-id',
            offers: [
                { '@type': 'Offer', '@id': '#masked-text-id' },
                { '@type': 'Offer', '@id': '#blocked-id' },
                { '@type': 'Offer', '@id': '#missing-id' },
                { '@type': 'Offer', '@id': '#json-ld-script' },
            ],
        })
        script.id = 'json-ld-script'
        document.body.append(script)
        const emit = jest.fn(() => true)
        const capture = startJsonLdCapture(document, MutationObserver, {
            blockClass: 'ph-no-capture',
            maskTextClass: 'ph-mask',
            emit,
        })

        capture.scan()

        expect(emit).toHaveBeenCalledWith({
            '@context': 'https://schema.org',
            '@type': 'Product',
            '@id': 'product-id',
            offers: [
                { '@type': 'Offer', '@id': 'masked-text-id' },
                { '@type': 'Offer' },
                { '@type': 'Offer' },
                { '@type': 'Offer' },
            ],
        })
        capture.stop()
    })

    it.each(['maskAllElementAttributes', 'maskAttributeFn'] as const)(
        'drops @id when %s can hide the matching DOM id',
        (maskingOption) => {
            document.body.innerHTML = '<div id="product-id"></div>'
            document.body.append(
                jsonLdScript({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    '@id': '#product-id',
                })
            )
            const emit = jest.fn(() => true)
            const masking =
                maskingOption === 'maskAllElementAttributes'
                    ? { maskAllElementAttributes: true }
                    : { maskAttributeFn: () => 'masked' }
            const capture = startJsonLdCapture(document, MutationObserver, { ...masking, emit })

            capture.scan()

            expect(emit).toHaveBeenCalledWith({
                '@context': 'https://schema.org',
                '@type': 'Product',
            })
            capture.stop()
        }
    )

    it('emits initial, added, and changed JSON-LD without duplicates', async () => {
        const emit = jest.fn(() => true)
        const initial = jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product', name: 'One' })
        document.body.appendChild(initial)

        const capture = startJsonLdCapture(document, MutationObserver, {
            blockClass: 'ph-no-capture',
            maskTextClass: 'ph-mask',
            emit,
        })
        capture.scan()

        expect(emit).toHaveBeenCalledWith({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: 'One',
        })

        const added = jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product', name: 'Two' })
        document.body.appendChild(added)
        await deliverMutations()

        added.textContent = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: 'Two',
            email: 'private@example.com',
        })
        await deliverMutations()

        added.textContent = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: 'Three',
        })
        await deliverMutations()

        expect(emit.mock.calls).toEqual([
            [{ '@context': 'https://schema.org', '@type': 'Product', name: 'One' }],
            [{ '@context': 'https://schema.org', '@type': 'Product', name: 'Two' }],
            [{ '@context': 'https://schema.org', '@type': 'Product', name: 'Three' }],
        ])

        capture.stop()
        document.body.appendChild(jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product', name: 'Four' }))
        await deliverMutations()
        expect(emit).toHaveBeenCalledTimes(3)
    })

    it('does not scan subtrees for ordinary text changes', async () => {
        const text = document.createTextNode('before')
        document.body.append(text)
        const querySelectorAll = jest.spyOn(Element.prototype, 'querySelectorAll')
        const capture = startJsonLdCapture(document, MutationObserver, { emit: jest.fn(() => true) })
        querySelectorAll.mockClear()

        text.data = 'after'
        await deliverMutations()

        expect(querySelectorAll).not.toHaveBeenCalled()
        querySelectorAll.mockRestore()
        capture.stop()
    })

    it('limits the total JSON-LD emitted by one recorder', async () => {
        for (let index = 0; index < 6; index++) {
            document.body.appendChild(
                jsonLdScript({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: `${index}${'x'.repeat(19_000)}`,
                })
            )
        }
        const emit = jest.fn(() => true)

        const capture = startJsonLdCapture(document, MutationObserver, { emit })
        capture.scan()
        const querySelectorAll = jest.spyOn(Element.prototype, 'querySelectorAll')
        const container = document.createElement('div')
        container.appendChild(jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product' }))
        document.body.append(container)
        await deliverMutations()

        expect(emit).toHaveBeenCalledTimes(5)
        expect(querySelectorAll).not.toHaveBeenCalled()
        querySelectorAll.mockRestore()
        capture.stop()
    })

    it('rescans after capture becomes enabled', () => {
        let enabled = false
        const emit = jest.fn(() => true)
        document.body.appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product', name: 'Camera' })
        )
        const capture = startJsonLdCapture(document, MutationObserver, {
            emit,
            getCaptureState: () => enabled,
        })

        expect(emit).not.toHaveBeenCalled()
        enabled = true
        capture.scan()
        expect(emit).toHaveBeenCalledWith({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: 'Camera',
        })
        capture.stop()
    })

    it('drops scripts moved before capture into a masked shadow root or another document', async () => {
        const emit = jest.fn(() => true)
        const capture = startJsonLdCapture(document, MutationObserver, {
            maskTextClass: 'ph-mask',
            emit,
        })
        const shadowHost = document.createElement('div')
        shadowHost.className = 'ph-mask'
        const shadowRoot = shadowHost.attachShadow({ mode: 'open' })
        document.body.append(shadowHost)
        const shadowScript = jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'Person',
            '@id': 'shadow-private',
        })
        document.body.append(shadowScript)
        shadowRoot.append(shadowScript)

        const iframe = document.createElement('iframe')
        document.body.append(iframe)
        const frameScript = jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'Person',
            '@id': 'frame-private',
        })
        document.body.append(frameScript)
        iframe.contentDocument!.body.append(frameScript)
        await deliverMutations()

        expect(emit).not.toHaveBeenCalled()
        capture.stop()
    })

    it('drops JSON-LD inside text masks and blocked elements', async () => {
        const emit = jest.fn(() => true)
        document.body.innerHTML = '<div class="ph-mask"></div><div class="private"></div>'
        document.body.children[0].appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Person', '@id': 'masked' })
        )
        document.body.children[1].appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Person', '@id': 'blocked' })
        )

        const capture = startJsonLdCapture(document, MutationObserver, {
            blockClass: 'ph-no-capture',
            blockSelector: '.private',
            maskTextClass: 'ph-mask',
            emit,
        })
        capture.scan()

        expect(emit).not.toHaveBeenCalled()

        document.body.children[0].appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Person', '@id': 'dynamic-masked' })
        )
        document.body.children[1].appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Person', '@id': 'dynamic-blocked' })
        )
        await deliverMutations()
        expect(emit).not.toHaveBeenCalled()

        const transient = jsonLdScript({ '@context': 'https://schema.org', '@type': 'Person', '@id': 'transient' })
        document.body.children[0].appendChild(transient)
        transient.remove()
        await deliverMutations()
        expect(emit).not.toHaveBeenCalled()
        capture.stop()
    })

    it('ignores non-JSON-LD scripts until their type changes', async () => {
        const emit = jest.fn(() => true)
        const value = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Camera' })
        const scripts = ['', 'text/javascript', 'application/json'].map((type) => {
            const script = document.createElement('script')
            script.type = type
            if (type === 'application/json') {
                script.textContent = value
            }
            document.body.appendChild(script)
            script.textContent = value
            return script
        })
        const capture = startJsonLdCapture(document, MutationObserver, { emit })

        capture.scan()
        expect(emit).not.toHaveBeenCalled()

        scripts[2].type = 'application/ld+json'
        await deliverMutations()
        expect(emit).toHaveBeenCalledWith({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: 'Camera',
        })
        capture.stop()
    })

    it('does not deduplicate an event that the recorder rejects', () => {
        let acceptsEvents = false
        const emit = jest.fn(() => acceptsEvents)
        document.body.appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product', name: 'Camera' })
        )
        const capture = startJsonLdCapture(document, MutationObserver, { emit })

        capture.scan()
        acceptsEvents = true
        capture.scan()
        capture.scan()

        expect(emit).toHaveBeenCalledTimes(2)
        capture.stop()
    })

    it('retries an event that a forced scan cannot emit', () => {
        let acceptsEvents = true
        const emit = jest.fn(() => acceptsEvents)
        document.body.appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product', name: 'Camera' })
        )
        const capture = startJsonLdCapture(document, MutationObserver, { emit })

        capture.scan()
        acceptsEvents = false
        capture.scan(true)
        acceptsEvents = true
        capture.scan()

        expect(emit).toHaveBeenCalledTimes(3)
        capture.stop()
    })
})
