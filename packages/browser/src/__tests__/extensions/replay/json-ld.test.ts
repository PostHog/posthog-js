import { sanitizeJsonLd, startJsonLdCapture } from '../../../extensions/replay/external/json-ld'

function jsonLdScript(value: unknown): HTMLScriptElement {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(value)
    return script
}

async function deliverMutations(): Promise<void> {
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

        expect(JSON.parse(sanitized!)).toEqual({
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

        expect(JSON.parse(sanitized!)).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: ['Camera', 2, true, null],
            category: false,
        })
    })

    it.each([
        'not json',
        JSON.stringify({ '@context': 'https://example.com', '@type': 'Product' }),
        JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event' }),
        JSON.stringify([
            { '@context': 'https://schema.org', '@type': 'Product' },
            { '@context': 'https://schema.org', '@type': 'Event' },
        ]),
    ])('drops an invalid JSON-LD document', (value) => {
        expect(sanitizeJsonLd(value)).toBeNull()
    })

    it('emits initial, added, and changed JSON-LD without duplicates', async () => {
        const emit = jest.fn()
        const initial = jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product', name: 'One' })
        document.body.appendChild(initial)

        const stop = startJsonLdCapture(document, MutationObserver, {
            blockClass: 'ph-no-capture',
            maskTextClass: 'ph-mask',
            emit,
        })

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
            name: 'Three',
        })
        await deliverMutations()

        expect(emit.mock.calls).toEqual([
            [{ '@context': 'https://schema.org', '@type': 'Product', name: 'One' }],
            [{ '@context': 'https://schema.org', '@type': 'Product', name: 'Two' }],
            [{ '@context': 'https://schema.org', '@type': 'Product', name: 'Three' }],
        ])

        stop()
        document.body.appendChild(jsonLdScript({ '@context': 'https://schema.org', '@type': 'Product', name: 'Four' }))
        await deliverMutations()
        expect(emit).toHaveBeenCalledTimes(3)
    })

    it('drops JSON-LD inside text masks and blocked elements', async () => {
        const emit = jest.fn()
        document.body.innerHTML = '<div class="ph-mask"></div><div class="private"></div>'
        document.body.children[0].appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Person', '@id': 'masked' })
        )
        document.body.children[1].appendChild(
            jsonLdScript({ '@context': 'https://schema.org', '@type': 'Person', '@id': 'blocked' })
        )

        const stop = startJsonLdCapture(document, MutationObserver, {
            blockClass: 'ph-no-capture',
            blockSelector: '.private',
            maskTextClass: 'ph-mask',
            emit,
        })

        expect(emit).not.toHaveBeenCalled()

        const transient = jsonLdScript({ '@context': 'https://schema.org', '@type': 'Person', '@id': 'transient' })
        document.body.children[0].appendChild(transient)
        transient.remove()
        await deliverMutations()
        expect(emit).not.toHaveBeenCalled()
        stop()
    })
})
