import { sanitizeJsonLd, startJsonLdCapture } from '../../../extensions/replay/external/json-ld'

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

    it('keeps only path-allowed properties and @id values', () => {
        const sanitized = sanitizeJsonLd(
            JSON.stringify({
                '@context': 'http://schema.org/',
                '@type': 'Product',
                '@id': 'https://example.com/products/123',
                name: 'Camera',
                email: 'private@example.com',
                manufacturer: {
                    '@type': 'Organization',
                    '@id': 'https://example.com/organizations/acme',
                    name: 'Acme',
                    email: 'private@example.com',
                },
                offers: {
                    '@type': 'Offer',
                    price: 100,
                    seller: {
                        '@type': 'Person',
                        name: 'Private name',
                    },
                },
            })
        )

        expect(sanitized?.[0]).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
            '@id': 'https://example.com/products/123',
            name: 'Camera',
            manufacturer: {
                '@type': 'Organization',
                '@id': 'https://example.com/organizations/acme',
                name: 'Acme',
            },
            offers: {
                '@type': 'Offer',
                price: 100,
            },
        })
    })

    it('keeps scalar leaf values and drops non-scalar leaf values', () => {
        const sanitized = sanitizeJsonLd(
            JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: ['Camera', 2, true, null],
                sku: { value: 'private' },
                color: ['black', { value: 'private' }],
                category: false,
            })
        )

        expect(sanitized?.[0]).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: ['Camera', 2, true, null],
            category: false,
        })
    })

    it('sanitizes root and nested entity arrays', () => {
        expect(
            sanitizeJsonLd(
                JSON.stringify([
                    {
                        '@context': 'https://schema.org',
                        '@type': 'Product',
                        name: 'Camera',
                        offers: [
                            { '@type': 'Offer', price: 100, email: 'private@example.com' },
                            { '@type': 'Person', '@id': 'private-person' },
                        ],
                    },
                    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' },
                ])
            )?.[0]
        ).toEqual([
            {
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Camera',
                offers: [{ '@type': 'Offer', price: 100 }],
            },
            { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' },
        ])
    })

    it.each([
        'not json',
        JSON.stringify({ '@context': 'https://example.com', '@type': 'Product' }),
        JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event' }),
        JSON.stringify({ '@context': 'https://schema.org', '@type': 'constructor', '@id': 'private@example.com' }),
        JSON.stringify({ '@context': 'https://schema.org', '@type': 'toString', '@id': 'private@example.com' }),
        JSON.stringify({ '@context': 'https://schema.org', '@type': '__proto__', '@id': 'private@example.com' }),
        JSON.stringify([
            { '@context': 'https://schema.org', '@type': 'Product' },
            { '@context': 'https://schema.org', '@type': 'Event' },
        ]),
    ])('drops an invalid JSON-LD document', (value) => {
        expect(sanitizeJsonLd(value)).toBeNull()
    })

    it('drops Person properties other than @id', () => {
        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Person',
                    '@id': 'person-id',
                    name: 'Private name',
                    email: 'private@example.com',
                })
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Person',
            '@id': 'person-id',
        })
    })

    it('ignores inherited JSON-LD properties', () => {
        const properties = ['@context', '@type', '@id', 'name']
        const values = ['https://schema.org', 'Product', 'private-id', 'private-name']
        const descriptors = properties.map((property) => Object.getOwnPropertyDescriptor(Object.prototype, property))
        let inheritedContext: ReturnType<typeof sanitizeJsonLd>
        let inheritedType: ReturnType<typeof sanitizeJsonLd>
        let inheritedLeaves: ReturnType<typeof sanitizeJsonLd>

        try {
            properties.forEach((property, index) => {
                Object.defineProperty(Object.prototype, property, {
                    configurable: true,
                    value: values[index],
                })
            })
            inheritedContext = sanitizeJsonLd(JSON.stringify({ '@type': 'Product' }))
            inheritedType = sanitizeJsonLd(JSON.stringify({ '@context': 'https://schema.org' }))
            inheritedLeaves = sanitizeJsonLd(JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product' }))
        } finally {
            properties.forEach((property, index) => {
                const descriptor = descriptors[index]
                if (descriptor) {
                    Object.defineProperty(Object.prototype, property, descriptor)
                } else {
                    Reflect.deleteProperty(Object.prototype, property)
                }
            })
        }

        expect(inheritedContext).toBeNull()
        expect(inheritedType).toBeNull()
        expect(inheritedLeaves?.[0]).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
        })
    })

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
            isEnabled: () => enabled,
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
})
