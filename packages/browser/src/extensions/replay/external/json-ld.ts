import { hasOwnProperty, isArray, isNull, isUndefined } from '@posthog/core'

type JsonLdScalar = string | number | boolean | null
type JsonLdPropertyRule = true | readonly string[]
type JsonLdEntityRules = Record<string, JsonLdPropertyRule>
type JsonLdRuleGroup = readonly [readonly string[], JsonLdEntityRules]

const MAX_JSON_LD_LENGTH = 100_000
const MAX_JSON_LD_OUTPUT_LENGTH = 20_000
const SCHEMA_CONTEXT = 'https://schema.org'

const ENTITY_RULES: Record<string, JsonLdEntityRules> = {
    Action: {
        actionStatus: true,
    },
    AggregateOffer: {
        lowPrice: true,
        highPrice: true,
        priceCurrency: true,
        offerCount: true,
        availability: true,
        offers: ['Offer'],
    },
    AggregateRating: {
        ratingValue: true,
        ratingCount: true,
        reviewCount: true,
        bestRating: true,
        worstRating: true,
    },
    Brand: {
        name: true,
    },
    CreativeWork: {
        genre: true,
        inLanguage: true,
        encodingFormat: true,
        dateCreated: true,
        dateModified: true,
        datePublished: true,
        expires: true,
        isAccessibleForFree: true,
        isFamilyFriendly: true,
        contentRating: true,
        learningResourceType: true,
        educationalLevel: true,
        educationalUse: true,
        interactivityType: true,
        aggregateRating: ['AggregateRating'],
        publisher: ['Organization'],
    },
    Event: {
        startDate: true,
        endDate: true,
        previousStartDate: true,
        eventStatus: true,
        eventAttendanceMode: true,
        maximumAttendeeCapacity: true,
        isAccessibleForFree: true,
        aggregateRating: ['AggregateRating'],
        offers: ['AggregateOffer', 'Offer'],
    },
    Offer: {
        price: true,
        priceCurrency: true,
        priceValidUntil: true,
        availability: true,
        itemCondition: true,
        seller: ['Organization'],
    },
    Organization: {
        name: true,
        legalName: true,
        foundingDate: true,
        dissolutionDate: true,
        nonprofitStatus: true,
        aggregateRating: ['AggregateRating'],
        brand: ['Brand'],
    },
    Person: {},
    Place: {
        publicAccess: true,
        smokingAllowed: true,
        maximumAttendeeCapacity: true,
        isAccessibleForFree: true,
        aggregateRating: ['AggregateRating'],
    },
    Product: {
        name: true,
        sku: true,
        mpn: true,
        gtin: true,
        gtin8: true,
        gtin12: true,
        gtin13: true,
        gtin14: true,
        productID: true,
        productGroupID: true,
        asin: true,
        model: true,
        category: true,
        color: true,
        material: true,
        pattern: true,
        size: true,
        productionDate: true,
        releaseDate: true,
        brand: ['Brand', 'Organization'],
        manufacturer: ['Organization'],
        offers: ['Offer', 'AggregateOffer'],
        aggregateRating: ['AggregateRating'],
    },
}

const EMPTY_ENTITY_RULES: JsonLdEntityRules = {}
const INHERITED_RULE_GROUPS: readonly JsonLdRuleGroup[] = [
    ['BorrowAction ReadAction SeekToAction SolveMathAction WatchAction'.split(' '), ENTITY_RULES.Action],
    [
        '3DModel Answer Article Blog BlogPosting Book Clip Comment Course CreativeWorkSeason CreativeWorkSeries DataCatalog DataDownload DataFeed Dataset DiscussionForumPosting Episode Game HowTo HowToDirection HowToSection HowToStep HowToTip ImageObject LearningResource MediaObject Message MobileApplication Movie MusicPlaylist MusicRecording NewsArticle ProfilePage QAPage Question Quiz Recipe Review SocialMediaPosting SoftwareApplication VacationRental VideoGame VideoObject WebApplication WebPage WebPageElement'.split(
            ' '
        ),
        ENTITY_RULES.CreativeWork,
    ],
    [['BroadcastEvent'], ENTITY_RULES.Event],
    [
        'DaySpa Electrician HealthClub Hotel Library LibrarySystem LocalBusiness Locksmith LodgingBusiness OnlineStore PerformingGroup Pharmacy Plumber Restaurant Store'.split(
            ' '
        ),
        ENTITY_RULES.Organization,
    ],
    ['Accommodation AdministrativeArea Country State'.split(' '), ENTITY_RULES.Place],
    ['Car ProductGroup'.split(' '), ENTITY_RULES.Product],
    ['EmployerAggregateRating Rating'.split(' '), ENTITY_RULES.AggregateRating],
]
const TYPES_WITHOUT_PROPERTIES =
    'AlignmentObject BedDetails BreadcrumbList Certification ContactPoint CreditCard DefinedRegion EducationalOccupationalCredential EntryPoint GeoCoordinates GeoShape InteractionCounter ItemList JobPosting ListItem LocationFeatureSpecification MathSolver MemberProgram MemberProgramTier MerchantReturnPolicy MerchantReturnPolicySeasonalOverride MonetaryAmount NutritionInformation OccupationalExperienceRequirements OfferShippingDetails OpeningHoursSpecification PeopleAudience PostalAddress PriceSpecification PropertyValue QuantitativeValue ServicePeriod ShippingConditions ShippingDeliveryTime ShippingRateSettings ShippingService SpeakableSpecification Thing UnitPriceSpecification'.split(
        ' '
    )

export const JSON_LD_EVENT_TAG = '$json_ld'

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && !isNull(value)
}

function getOwnProperty(value: Record<string, unknown>, property: string): unknown {
    return hasOwnProperty.call(value, property) ? value[property] : undefined
}

function isScalar(value: unknown): value is JsonLdScalar {
    const type = typeof value
    return isNull(value) || type === 'string' || type === 'number' || type === 'boolean'
}

function sanitizeScalar(value: unknown): JsonLdScalar | JsonLdScalar[] | undefined {
    return isScalar(value) || (isArray(value) && value.every(isScalar)) ? value : undefined
}

function getEntityRules(type: string): JsonLdEntityRules | undefined {
    if (hasOwnProperty.call(ENTITY_RULES, type)) {
        return ENTITY_RULES[type]
    }
    for (const [types, rules] of INHERITED_RULE_GROUPS) {
        if (types.includes(type)) {
            return rules
        }
    }
    return TYPES_WITHOUT_PROPERTIES.includes(type) ? EMPTY_ENTITY_RULES : undefined
}

function getEntityTypes(value: unknown): string[] {
    const values = typeof value === 'string' ? [value] : isArray(value) ? value : []
    return values
        .filter((type): type is string => typeof type === 'string')
        .map((type) => type.replace(/^https?:\/\/schema\.org\//, ''))
        .filter((type) => !!getEntityRules(type))
}

function sanitizeEntity(value: unknown, allowedTypes?: readonly string[]): Record<string, unknown> | null {
    if (!isObject(value)) {
        return null
    }
    const typeValue = getOwnProperty(value, '@type')
    const types = getEntityTypes(typeValue).filter((type) => !allowedTypes || allowedTypes.includes(type))
    if (!types.length) {
        return null
    }

    const result: Record<string, unknown> = { '@type': typeof typeValue === 'string' ? types[0] : types }
    const id = sanitizeScalar(getOwnProperty(value, '@id'))
    if (!isUndefined(id)) {
        result['@id'] = id
    }

    for (const type of types) {
        const rules = getEntityRules(type)!
        for (const property of Object.keys(rules)) {
            const propertyValue = getOwnProperty(value, property)
            const rule = rules[property]
            if (rule === true) {
                const scalar = sanitizeScalar(propertyValue)
                if (!isUndefined(scalar)) {
                    result[property] = scalar
                }
            } else if (isArray(propertyValue)) {
                const items = propertyValue.map((item) => sanitizeEntity(item, rule)).filter(isObject)
                if (items.length) {
                    result[property] = items
                }
            } else {
                const nestedEntity = sanitizeEntity(propertyValue, rule)
                if (nestedEntity) {
                    result[property] = nestedEntity
                }
            }
        }
    }

    return result
}

function sanitizeRoot(value: unknown): Record<string, unknown> | null {
    if (!isObject(value)) {
        return null
    }
    const context = getOwnProperty(value, '@context')
    if (typeof context !== 'string' || !/^https?:\/\/schema\.org\/?$/.test(context)) {
        return null
    }

    const entity = sanitizeEntity(value)
    return entity ? { '@context': SCHEMA_CONTEXT, ...entity } : null
}

export function sanitizeJsonLd(text: string): [unknown, string] | null {
    if (!text || text.length > MAX_JSON_LD_LENGTH) {
        return null
    }

    try {
        const value: unknown = JSON.parse(text)
        const sanitized = isArray(value) ? value.map(sanitizeRoot) : sanitizeRoot(value)
        if (isNull(sanitized) || (isArray(sanitized) && (!sanitized.length || sanitized.some(isNull)))) {
            return null
        }

        const output = JSON.stringify(sanitized)
        return output.length <= MAX_JSON_LD_OUTPUT_LENGTH ? [sanitized, output] : null
    } catch {
        return null
    }
}

function isJsonLdScript(node: Node): node is HTMLScriptElement {
    return (
        node.nodeName === 'SCRIPT' &&
        (node as Element).getAttribute('type')?.trim().toLowerCase() === 'application/ld+json'
    )
}

type JsonLdPrivacyOptions = {
    blockClass?: string | RegExp
    blockSelector?: string | null
    maskTextClass?: string | RegExp
    maskTextSelector?: string | null
}

function matchesPrivacyRule(element: Element, classRule?: string | RegExp, selector?: string | null): boolean {
    if (
        typeof classRule === 'string'
            ? element.classList.contains(classRule)
            : classRule &&
              Array.from(element.classList).some((className) => {
                  classRule.lastIndex = 0
                  return classRule.test(className)
              })
    ) {
        return true
    }
    try {
        return !!selector && element.matches(selector)
    } catch {
        return false
    }
}

function isWithinPrivacyBoundary(element: Element, options: JsonLdPrivacyOptions): boolean {
    for (let current: Element | null = element; current; ) {
        if (
            matchesPrivacyRule(current, options.blockClass, options.blockSelector) ||
            matchesPrivacyRule(current, options.maskTextClass, options.maskTextSelector)
        ) {
            return true
        }
        const parentNode: Node | null = current.parentNode
        current =
            current.parentElement ||
            (parentNode && parentNode.nodeType === parentNode.DOCUMENT_FRAGMENT_NODE
                ? (parentNode as ShadowRoot).host
                : null)
    }
    return false
}

function getJsonLdScripts(node: Node): HTMLScriptElement[] {
    if (isJsonLdScript(node)) {
        return [node]
    }
    if (node.nodeType !== node.ELEMENT_NODE) {
        return []
    }
    return Array.from((node as Element).querySelectorAll('script')).filter(isJsonLdScript)
}

export function startJsonLdCapture(
    doc: Document,
    MutationObserverClass: typeof MutationObserver,
    options: JsonLdPrivacyOptions & {
        emit: (jsonLd: unknown) => boolean
        // Null updates the deduplication baseline without an event.
        getCaptureState?: () => boolean | null
    }
): { scan: (force?: boolean) => void; stop: () => void } {
    const lastJsonByScript = new WeakMap<HTMLScriptElement, string>()
    let remainingLength = MAX_JSON_LD_LENGTH

    const captureScript = (script: HTMLScriptElement, force = false): void => {
        try {
            const captureState = options.getCaptureState ? options.getCaptureState() : true
            if (
                !remainingLength ||
                captureState === false ||
                !script.isConnected ||
                script.ownerDocument !== doc ||
                isWithinPrivacyBoundary(script, options)
            ) {
                return
            }
            const sanitized = sanitizeJsonLd(script.text)
            if (!sanitized) {
                lastJsonByScript.delete(script)
                return
            }
            const [jsonLd, json] = sanitized
            if (isNull(captureState)) {
                lastJsonByScript.set(script, json)
                return
            }
            if (force || lastJsonByScript.get(script) !== json) {
                if (json.length > remainingLength) {
                    remainingLength = 0
                    return
                }
                if (options.emit(jsonLd)) {
                    lastJsonByScript.set(script, json)
                    remainingLength -= json.length
                }
            }
        } catch {
            return
        }
    }

    try {
        const observer = new MutationObserverClass((mutations) => {
            try {
                if (!remainingLength || options.getCaptureState?.() === false) {
                    return
                }
                const scripts = new Set<HTMLScriptElement>()
                const addScripts = (node: Node): void => {
                    for (const script of getJsonLdScripts(node)) {
                        scripts.add(script)
                    }
                }

                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        if (isJsonLdScript(mutation.target)) {
                            scripts.add(mutation.target)
                        }
                        mutation.addedNodes.forEach(addScripts)
                    } else if (mutation.type === 'characterData') {
                        const parent = mutation.target.parentNode
                        if (parent && isJsonLdScript(parent)) {
                            scripts.add(parent)
                        }
                    } else if (mutation.type === 'attributes' && isJsonLdScript(mutation.target)) {
                        scripts.add(mutation.target)
                    }
                }

                scripts.forEach((script) => captureScript(script))
            } catch {
                return
            }
        })

        observer.observe(doc, {
            attributes: true,
            attributeFilter: ['type'],
            characterData: true,
            childList: true,
            subtree: true,
        })
        const scan = (force = false): void => {
            if (!remainingLength || options.getCaptureState?.() === false) {
                return
            }
            getJsonLdScripts(doc.documentElement).forEach((script) => captureScript(script, force))
        }

        return { scan, stop: () => observer.disconnect() }
    } catch {
        return { scan: () => {}, stop: () => {} }
    }
}
