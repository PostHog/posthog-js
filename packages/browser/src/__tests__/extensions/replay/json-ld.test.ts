import { isNull } from '@posthog/core'

import { sanitizeJsonLd, startJsonLdCapture } from '../../../extensions/replay/external/json-ld'
import jsonLdContract from '../../../../test-fixtures/json-ld-sanitization-v1.json'

type JsonLdContract = {
    schemaVersion: 1
    limits: {
        maxTypeLength: number
        maxSourceLength: number
        maxPayloadLength: number
    }
    cases: Array<{
        name: string
        capturedDomIds: string[]
        input: unknown
        expected: unknown
    }>
}

const contract = jsonLdContract as JsonLdContract

const GOOGLE_SEARCH_TYPES =
    '3DModel Accommodation Action AdministrativeArea AggregateOffer AggregateRating AlignmentObject Answer Article BedDetails Blog BlogPosting Book BorrowAction Brand BreadcrumbList BroadcastEvent Car Certification Clip Comment ContactPoint Country Course CreativeWork CreativeWorkSeason CreativeWorkSeries CreditCard DataCatalog DataDownload DataFeed Dataset DaySpa DefinedRegion DiscussionForumPosting EducationalOccupationalCredential Electrician EmployerAggregateRating EntryPoint Episode Event Game GeoCoordinates GeoShape HealthClub Hotel HowTo HowToDirection HowToSection HowToStep HowToTip ImageObject InteractionCounter ItemList JobPosting LearningResource Library LibrarySystem ListItem LocalBusiness LocationFeatureSpecification Locksmith LodgingBusiness MathSolver MediaObject MemberProgram MemberProgramTier MerchantReturnPolicy MerchantReturnPolicySeasonalOverride Message MobileApplication MonetaryAmount Movie MusicPlaylist MusicRecording NewsArticle NutritionInformation OccupationalExperienceRequirements Offer OfferShippingDetails OnlineStore OpeningHoursSpecification Organization PeopleAudience PerformingGroup Person Pharmacy Place Plumber PostalAddress PriceSpecification Product ProductGroup ProfilePage PropertyValue QAPage QuantitativeValue Question Quiz Rating ReadAction Recipe Restaurant Review SeekToAction ServicePeriod ShippingConditions ShippingDeliveryTime ShippingRateSettings ShippingService SocialMediaPosting SoftwareApplication SolveMathAction SpeakableSpecification State Store Thing UnitPriceSpecification VacationRental VideoGame VideoObject WatchAction WebApplication WebPage WebPageElement'.split(
        ' '
    )
const COMMON_SCHEMA_TYPES =
    'AboutPage AudioObject AutoDealer Bakery BarOrPub BusinessEvent CafeOrCoffeeShop CollegeOrUniversity CollectionPage ContactPage Corporation Dentist EducationEvent EducationalOrganization FAQPage Festival FoodEstablishment GovernmentOrganization IndividualProduct LegalService MedicalBusiness MusicEvent NGO OfferCatalog Photograph Physician PodcastEpisode PodcastSeries ProductModel RealEstateAgent ScholarlyArticle School SearchAction SearchResultsPage Service SiteNavigationElement SportsEvent SportsOrganization TVEpisode TVSeries TechArticle TheaterEvent WebSite'.split(
        ' '
    )

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

function capturedDomIds(...ids: string[]): (id: string) => boolean {
    return (id) => ids.includes(id)
}

describe('JSON-LD replay capture', () => {
    afterEach(() => {
        document.body.replaceChildren()
    })

    it('uses the supported sanitization contract version', () => {
        expect(contract.schemaVersion).toBe(1)
    })

    it.each(contract.cases)('matches the published contract: $name', ({ capturedDomIds: ids, input, expected }) => {
        const sanitized = sanitizeJsonLd(JSON.stringify(input), capturedDomIds(...ids))
        expect(sanitized?.[0] ?? null).toEqual(expected)
    })

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

    it('accepts every Google-listed type', () => {
        for (const type of GOOGLE_SEARCH_TYPES) {
            expect(sanitizeJsonLd(JSON.stringify({ '@context': 'https://schema.org', '@type': type }))?.[0]).toEqual({
                '@context': 'https://schema.org',
                '@type': type,
            })
        }
    })

    it('accepts common Schema.org types outside the Google list', () => {
        for (const type of COMMON_SCHEMA_TYPES) {
            expect(sanitizeJsonLd(JSON.stringify({ '@context': 'https://schema.org', '@type': type }))?.[0]).toEqual({
                '@context': 'https://schema.org',
                '@type': type,
            })
        }
    })

    it('sanitizes root graphs and keeps unsupported graph entity types', () => {
        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@graph': [
                        {
                            '@type': 'WebSite',
                            datePublished: '2026-08-25',
                            email: 'private@example.com',
                            potentialAction: {
                                '@type': 'SearchAction',
                                actionStatus: 'https://schema.org/PotentialActionStatus',
                                target: 'https://example.com/search?q={private}',
                            },
                        },
                        {
                            '@type': 'FAQPage',
                            inLanguage: 'en',
                            text: 'Private question and answer',
                        },
                        {
                            '@type': 'Person',
                            '@id': 'person-id',
                            name: 'Private name',
                        },
                        {
                            '@type': 'PrivateType',
                            email: 'private@example.com',
                        },
                        'private@example.com',
                    ],
                }),
                capturedDomIds('person-id')
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@graph': [
                {
                    '@type': 'WebSite',
                    datePublished: '2026-08-25',
                    potentialAction: {
                        '@type': 'SearchAction',
                        actionStatus: 'https://schema.org/PotentialActionStatus',
                    },
                },
                {
                    '@type': 'FAQPage',
                    inLanguage: 'en',
                },
                {
                    '@type': 'Person',
                    '@id': 'person-id',
                },
                {
                    '@type': 'PrivateType',
                },
            ],
        })
    })

    it.each(['BreadcrumbList', 'ItemList'])('sanitizes nested items in %s', (type) => {
        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': type,
                    itemListElement: [
                        {
                            '@type': 'ListItem',
                            position: 1,
                            name: 'Private label',
                            item: {
                                '@type': 'Product',
                                name: 'Camera',
                                email: 'private@example.com',
                            },
                        },
                        {
                            '@type': 'Person',
                            '@id': 'private-person',
                        },
                    ],
                }),
                capturedDomIds('private-person')
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': type,
            itemListElement: [
                {
                    '@type': 'ListItem',
                    position: 1,
                    item: {
                        '@type': 'Product',
                        name: 'Camera',
                    },
                },
                {
                    '@type': 'Person',
                    '@id': 'private-person',
                },
            ],
        })
    })

    it('sanitizes offer catalogs and services', () => {
        expect(
            sanitizeJsonLd(
                JSON.stringify([
                    {
                        '@context': 'https://schema.org',
                        '@type': 'OfferCatalog',
                        name: 'Services',
                        itemListElement: {
                            '@type': 'Offer',
                            price: 100,
                            email: 'private@example.com',
                        },
                    },
                    {
                        '@context': 'https://schema.org',
                        '@type': 'Service',
                        name: 'Installation',
                        serviceType: 'Installation',
                        email: 'private@example.com',
                        provider: {
                            '@type': 'EducationalOrganization',
                            name: 'Acme',
                            telephone: '+44 0000 000000',
                        },
                    },
                ])
            )?.[0]
        ).toEqual([
            {
                '@context': 'https://schema.org',
                '@type': 'OfferCatalog',
                name: 'Services',
                itemListElement: {
                    '@type': 'Offer',
                    price: 100,
                },
            },
            {
                '@context': 'https://schema.org',
                '@type': 'Service',
                name: 'Installation',
                serviceType: 'Installation',
                provider: {
                    '@type': 'EducationalOrganization',
                    name: 'Acme',
                },
            },
        ])
    })

    it('sanitizes type arrays and full Schema.org type URLs', () => {
        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': ['https://schema.org/Product', 'Car', 'PrivateType', 42],
                    name: 'Camera',
                    email: 'private@example.com',
                })
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': ['Product', 'Car', 'PrivateType'],
            name: 'Camera',
        })

        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'https://schema.org/Organization',
                    name: 'Acme',
                })
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Acme',
        })
    })

    it('keeps DOM-backed @id fragments and path-allowed properties', () => {
        const sanitized = sanitizeJsonLd(
            JSON.stringify({
                '@context': 'http://schema.org/',
                '@type': 'Product',
                '@id': 'https://example.com/products/123#product-id',
                name: 'Camera',
                email: 'private@example.com',
                manufacturer: {
                    '@type': 'Organization',
                    '@id': 'https://example.com/organizations/acme#organization-id',
                    name: 'Acme',
                    email: 'private@example.com',
                },
                offers: {
                    '@type': 'Offer',
                    '@id': 'https://example.com/offers/1',
                    price: 100,
                    seller: {
                        '@type': 'Person',
                        '@id': '#missing-id',
                        name: 'Private name',
                    },
                },
            }),
            capturedDomIds('product-id', 'organization-id')
        )

        expect(sanitized?.[0]).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
            '@id': 'product-id',
            name: 'Camera',
            manufacturer: {
                '@type': 'Organization',
                '@id': 'organization-id',
                name: 'Acme',
            },
            offers: {
                '@type': 'Offer',
                price: 100,
                seller: {
                    '@type': 'Person',
                },
            },
        })
    })

    it('drops @id values that have no fragment or no captured DOM match', () => {
        const isCapturedDomId = jest.fn(() => true)

        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    '@id': 'https://example.com/products/123',
                }),
                isCapturedDomId
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
        })
        expect(isCapturedDomId).not.toHaveBeenCalled()

        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    '@id': '#missing-id',
                })
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
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

    it('keeps universally allowed properties on unknown types and drops unallowlisted property branches', () => {
        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'CustomType',
                    privateRootValue: 'private',
                    customMetadata: {
                        availability: 'https://schema.org/InStock',
                        isAccessibleForFree: true,
                        name: 'Private name',
                        numberOfItems: 2,
                        priceCurrency: 'GBP',
                        nestedMetadata: {
                            ratingValue: 4.5,
                            privateNestedValue: 'private',
                        },
                    },
                })
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': 'CustomType',
        })
    })

    it('drops unallowlisted property names and their nested safe fields', () => {
        const sanitized = sanitizeJsonLd(
            JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                'private@example.com': {
                    '@type': 'CustomMetadata',
                    ratingValue: 4.5,
                },
            })
        )

        expect(sanitized?.[0]).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
        })
        expect(sanitized?.[1]).not.toContain('private@example.com')
        expect(sanitized?.[1]).not.toContain('ratingValue')
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
                ]),
                capturedDomIds('private-person')
            )?.[0]
        ).toEqual([
            {
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Camera',
                offers: [
                    { '@type': 'Offer', price: 100 },
                    { '@type': 'Person', '@id': 'private-person' },
                ],
            },
            { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' },
        ])
    })

    it('drops entity branches when their property paths are not allowlisted', () => {
        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    '@id': 'root-id',
                    name: 'Camera',
                    privateRootValue: 'private',
                    customChild: {
                        '@type': 'CustomChild',
                        '@id': 'child-id',
                        privateChildValue: 'private',
                        nestedEntity: {
                            '@type': 'Product',
                            '@id': 'product-id',
                            name: 'Private product name',
                            ratingValue: 4.5,
                        },
                        idOnlyNode: {
                            '@id': 'reference-id',
                            privateReferenceValue: 'private',
                        },
                    },
                }),
                capturedDomIds('root-id', 'child-id', 'product-id', 'reference-id')
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': 'Product',
            '@id': 'root-id',
            name: 'Camera',
        })
    })

    it.each([
        'not json',
        JSON.stringify({ '@context': 'https://example.com', '@type': 'Product' }),
        JSON.stringify({ '@context': 'https://schema.org', privateValue: 'private' }),
    ])('drops an invalid JSON-LD document', (value) => {
        expect(sanitizeJsonLd(value)).toBeNull()
    })

    it.each(['PrivateType', 'constructor', 'toString', '__proto__'])('keeps the unsupported %s type', (type) => {
        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': type,
                    '@id': 'entity-id',
                    privateValue: 'private',
                }),
                capturedDomIds('entity-id')
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': type,
            '@id': 'entity-id',
        })
    })

    it.each(['ContactPoint', 'Person', 'PostalAddress'])('drops PII-bearing %s properties', (type) => {
        expect(
            sanitizeJsonLd(
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': type,
                    '@id': 'entity-id',
                    name: 'Private name',
                    email: 'private@example.com',
                    telephone: '+44 0000 000000',
                    streetAddress: 'Private address',
                }),
                capturedDomIds('entity-id')
            )?.[0]
        ).toEqual({
            '@context': 'https://schema.org',
            '@type': type,
            '@id': 'entity-id',
        })
    })

    it('ignores inherited JSON-LD properties', () => {
        const properties = ['@context', '@type', '@id', 'name', 'ratingValue']
        const values = ['https://schema.org', 'Product', 'private-id', 'private-name', 5]
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
