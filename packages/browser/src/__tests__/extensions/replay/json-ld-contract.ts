import { isNull } from '@posthog/core'

type JsonLdContract = {
    schemaVersion: number
    limits: {
        maxTypeLength: number
        maxSourceLength: number
        maxPayloadLength: number
    }
    typeSets: Array<{
        name: string
        types: string[]
    }>
    cases: Array<{
        name: string
        capturedDomIds: string[]
        input: unknown
        expected: unknown
    }>
    rawSourceCases: Array<{
        name: string
        source: string
        expected: unknown
    }>
    prototypeCases: Array<{
        name: string
        inheritedProperties: Record<string, unknown>
        capturedDomIds: string[]
        input: unknown
        expected: unknown
    }>
}

type SanitizeJsonLd = (text: string, isCapturedDomId?: (id: string) => boolean) => readonly [unknown, string] | null

function capturedDomIds(...ids: string[]): (id: string) => boolean {
    return (id) => ids.includes(id)
}

export function addJsonLdContractTests(contractValue: unknown, sanitizeJsonLd: SanitizeJsonLd): void {
    const contract = contractValue as JsonLdContract

    it('uses the supported sanitization contract version', () => {
        expect(contract.schemaVersion).toBe(1)
    })

    it.each(contract.cases)('matches the published contract: $name', ({ capturedDomIds: ids, input, expected }) => {
        const sanitized = sanitizeJsonLd(JSON.stringify(input), capturedDomIds(...ids))
        expect(sanitized?.[0] ?? null).toEqual(expected)
    })

    it.each(contract.typeSets)('keeps every published type in $name', ({ types }) => {
        for (const type of types) {
            const input = { '@context': 'https://schema.org', '@type': type }
            expect(sanitizeJsonLd(JSON.stringify(input))?.[0]).toEqual(input)
        }
    })

    it.each(contract.rawSourceCases)('matches the browser-only source contract: $name', ({ source, expected }) => {
        expect(sanitizeJsonLd(source)?.[0] ?? null).toEqual(expected)
    })

    it.each(contract.prototypeCases)(
        'matches the inherited-property contract: $name',
        ({ inheritedProperties, capturedDomIds: ids, input, expected }) => {
            const descriptors = Object.fromEntries(
                Object.keys(inheritedProperties).map((property) => [
                    property,
                    Object.getOwnPropertyDescriptor(Object.prototype, property),
                ])
            )

            try {
                for (const [property, value] of Object.entries(inheritedProperties)) {
                    Object.defineProperty(Object.prototype, property, {
                        configurable: true,
                        value,
                    })
                }
                const sanitized = sanitizeJsonLd(JSON.stringify(input), capturedDomIds(...ids))
                expect(sanitized?.[0] ?? null).toEqual(expected)
            } finally {
                for (const [property, descriptor] of Object.entries(descriptors)) {
                    if (descriptor) {
                        Object.defineProperty(Object.prototype, property, descriptor)
                    } else {
                        Reflect.deleteProperty(Object.prototype, property)
                    }
                }
            }
        }
    )

    it('enforces the published type and payload limits', () => {
        const { maxTypeLength, maxSourceLength, maxPayloadLength } = contract.limits
        const root = (type: string, name: string | null = null): Record<string, unknown> => ({
            '@context': 'https://schema.org',
            '@type': type,
            ...(isNull(name) ? {} : { name }),
        })

        expect(sanitizeJsonLd(JSON.stringify(root('T'.repeat(maxTypeLength))))?.[0]).toEqual(
            root('T'.repeat(maxTypeLength))
        )
        expect(sanitizeJsonLd(JSON.stringify(root('T'.repeat(maxTypeLength + 1))))).toBeNull()
        expect(sanitizeJsonLd(JSON.stringify(root('😀'.repeat(50))))?.[0]).toEqual(root('😀'.repeat(50)))
        expect(sanitizeJsonLd(JSON.stringify(root('😀'.repeat(51))))).toBeNull()

        const sourcePrefix = '{"@context":"https://schema.org","@type":"Product","private":"'
        const sourceSuffix = '"}'
        const sourceAtLimit =
            sourcePrefix + 'x'.repeat(maxSourceLength - sourcePrefix.length - sourceSuffix.length) + sourceSuffix
        expect(sourceAtLimit).toHaveLength(maxSourceLength)
        expect(sanitizeJsonLd(sourceAtLimit)?.[0]).toEqual(root('Product'))
        expect(sanitizeJsonLd(sourceAtLimit + ' ')).toBeNull()

        const emptyPayloadLength = JSON.stringify(root('Product', '')).length
        const nameAtLimit = 'x'.repeat(maxPayloadLength - emptyPayloadLength)
        expect(sanitizeJsonLd(JSON.stringify(root('Product', nameAtLimit)))?.[1]).toHaveLength(maxPayloadLength)
        expect(sanitizeJsonLd(JSON.stringify(root('Product', nameAtLimit + 'x')))).toBeNull()
    })
}
