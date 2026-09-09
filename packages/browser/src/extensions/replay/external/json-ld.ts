import { hasOwnProperty, isArray, isNull, isObject, isUndefined } from '@posthog/core'

type JsonLdScalar = string | number | boolean | null
type JsonLdPropertyRule = true | readonly string[]
type JsonLdEntityRules = Record<string, JsonLdPropertyRule>
type JsonLdRuleGroup = readonly [readonly string[], JsonLdEntityRules]
type IsCapturedDomId = (id: string) => boolean
type MaskJsonLdUrl = (url: string) => string | undefined

const MAX_JSON_LD_LENGTH = 100_000
const MAX_JSON_LD_OUTPUT_LENGTH = 20_000
const MAX_JSON_LD_TYPE_LENGTH = 100
const SCHEMA_TERM_PATTERN = /^[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/
const MAX_JSON_LD_TYPES = 20
const MAX_JSON_LD_NODES = 2_048
const SCHEMA_CONTEXT = 'https://schema.org'
const ANY_ENTITY_TYPES: readonly string[] = []
const NO_CAPTURED_DOM_IDS: IsCapturedDomId = () => false
const UNIVERSALLY_ALLOWED_PROPERTIES =
    '@type @id actionStatus availability bestRating contentRating encodingFormat eventAttendanceMode eventStatus highPrice inLanguage isAccessibleForFree isFamilyFriendly itemCondition itemListOrder lowPrice maximumAttendeeCapacity nonprofitStatus numberOfItems offerCount position price priceCurrency priceValidUntil publicAccess ratingCount ratingValue reviewCount smokingAllowed worstRating'.split(
        ' '
    )
const ACTION_TYPES = 'Action BorrowAction ReadAction SearchAction SeekToAction SolveMathAction WatchAction'.split(' ')
const ORGANIZATION_TYPES =
    'AutoDealer Bakery BarOrPub CafeOrCoffeeShop CollegeOrUniversity Corporation DaySpa Dentist EducationalOrganization Electrician FoodEstablishment GovernmentOrganization HealthClub Hotel LegalService Library LibrarySystem LocalBusiness Locksmith LodgingBusiness MedicalBusiness NGO OnlineStore Organization PerformingGroup Pharmacy Physician Plumber RealEstateAgent Restaurant School SportsOrganization Store'.split(
        ' '
    )
const PLACE_TYPES = 'Accommodation AdministrativeArea Country Place State'.split(' ')

const ENTITY_RULES: Record<string, JsonLdEntityRules> = {
    AggregateOffer: {
        offers: ['Offer'],
    },
    Brand: {
        name: true,
    },
    BreadcrumbList: {
        itemListElement: ['ListItem'],
    },
    CreativeWork: {
        genre: true,
        dateCreated: true,
        dateModified: true,
        datePublished: true,
        expires: true,
        learningResourceType: true,
        educationalLevel: true,
        educationalUse: true,
        interactivityType: true,
        aggregateRating: ['AggregateRating'],
        potentialAction: ACTION_TYPES,
        publisher: ORGANIZATION_TYPES,
    },
    Event: {
        startDate: true,
        endDate: true,
        previousStartDate: true,
        aggregateRating: ['AggregateRating'],
        offers: ['AggregateOffer', 'Offer'],
    },
    ItemList: {
        itemListElement: ['ListItem'],
    },
    ListItem: {
        item: ANY_ENTITY_TYPES,
    },
    Offer: {
        seller: ORGANIZATION_TYPES,
    },
    Organization: {
        name: true,
        legalName: true,
        foundingDate: true,
        dissolutionDate: true,
        aggregateRating: ['AggregateRating'],
        brand: ['Brand'],
    },
    Place: {
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
        manufacturer: ORGANIZATION_TYPES,
        offers: ['Offer', 'AggregateOffer'],
        aggregateRating: ['AggregateRating'],
    },
    Service: {
        name: true,
        serviceType: true,
        category: true,
        provider: ORGANIZATION_TYPES,
        areaServed: PLACE_TYPES,
        offers: ['AggregateOffer', 'Offer'],
        aggregateRating: ['AggregateRating'],
    },
    OfferCatalog: {
        name: true,
        itemListElement: ANY_ENTITY_TYPES,
    },
}

const INHERITED_RULE_GROUPS: readonly JsonLdRuleGroup[] = [
    [
        '3DModel AboutPage Answer Article AudioObject Blog BlogPosting Book Clip CollectionPage Comment ContactPage Course CreativeWorkSeason CreativeWorkSeries DataCatalog DataDownload DataFeed Dataset DiscussionForumPosting Episode FAQPage Game HowTo HowToDirection HowToSection HowToStep HowToTip ImageObject LearningResource MediaObject Message MobileApplication Movie MusicPlaylist MusicRecording NewsArticle Photograph PodcastEpisode PodcastSeries ProfilePage QAPage Question Quiz Recipe Review ScholarlyArticle SearchResultsPage SiteNavigationElement SocialMediaPosting SoftwareApplication TVEpisode TVSeries TechArticle VacationRental VideoGame VideoObject WebApplication WebPage WebPageElement WebSite'.split(
            ' '
        ),
        ENTITY_RULES.CreativeWork,
    ],
    [
        'BroadcastEvent BusinessEvent EducationEvent Festival MusicEvent SportsEvent TheaterEvent'.split(' '),
        ENTITY_RULES.Event,
    ],
    [ORGANIZATION_TYPES, ENTITY_RULES.Organization],
    [PLACE_TYPES, ENTITY_RULES.Place],
    ['Car IndividualProduct ProductGroup ProductModel'.split(' '), ENTITY_RULES.Product],
]

export const JSON_LD_EVENT_TAG = '$json_ld'

function getOwnProperty(value: Record<string, unknown>, property: string): unknown {
    return hasOwnProperty.call(value, property) ? value[property] : undefined
}

function isScalar(value: unknown): value is JsonLdScalar {
    const type = typeof value
    return isNull(value) || type === 'string' || type === 'number' || type === 'boolean'
}

function maskScalarUrl(value: JsonLdScalar, maskUrl?: MaskJsonLdUrl): JsonLdScalar | undefined {
    return maskUrl && typeof value === 'string' && /^(https?:\/\/|\/|\.\.?\/)/i.test(value.trim())
        ? maskUrl(value.trim()) || undefined
        : value
}

function sanitizeScalar(value: unknown, maskUrl?: MaskJsonLdUrl): JsonLdScalar | JsonLdScalar[] | undefined {
    if (isArray(value) && value.every(isScalar)) {
        return value.map((item) => maskScalarUrl(item, maskUrl)).filter((item) => !isUndefined(item))
    }
    return isScalar(value) ? maskScalarUrl(value, maskUrl) : undefined
}

function sanitizeId(value: unknown, isCapturedDomId: IsCapturedDomId): string | undefined {
    if (typeof value !== 'string') {
        return undefined
    }

    const id = value.trim()
    const hashIndex = id.indexOf('#')
    const fragment = hashIndex >= 0 ? id.slice(hashIndex + 1) : id
    if (!fragment || (hashIndex < 0 && (/^[a-z][a-z\d+.-]*:/i.test(id) || id.includes('/') || id.includes('?')))) {
        return undefined
    }

    try {
        return isCapturedDomId(fragment) ? fragment : undefined
    } catch {
        return undefined
    }
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
    return undefined
}

function getEntityTypes(value: unknown): string[] {
    const seen = new Set<string>()
    const values = typeof value === 'string' ? [value] : isArray(value) ? value : []
    const types: string[] = []
    for (const value of values) {
        if (typeof value !== 'string') {
            continue
        }
        const type = value.replace(/^https?:\/\/schema\.org\//, '')
        if (type.length > MAX_JSON_LD_TYPE_LENGTH || !SCHEMA_TERM_PATTERN.test(type) || seen.has(type)) {
            continue
        }
        seen.add(type)
        types.push(type)
        if (types.length === MAX_JSON_LD_TYPES) {
            break
        }
    }
    return types
}

type SanitizationContext = {
    maskUrl?: MaskJsonLdUrl
    remainingNodes: number
    exceeded: boolean
}

function takeNode(context: SanitizationContext): boolean {
    if (!context.remainingNodes) {
        context.exceeded = true
        return false
    }
    context.remainingNodes--
    return true
}

function setOwnProperty(result: Record<string, unknown>, property: string, value: unknown): void {
    Object.defineProperty(result, property, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    })
}

function sanitizeEntityValue(
    value: unknown,
    isCapturedDomId: IsCapturedDomId,
    context: SanitizationContext,
    allowedTypes?: readonly string[]
): unknown | undefined {
    if (isArray(value)) {
        const items = value
            .map((item) => sanitizeEntityValue(item, isCapturedDomId, context, allowedTypes))
            .filter((item) => !isUndefined(item))
        return items.length ? items : undefined
    }

    return sanitizeEntity(value, isCapturedDomId, context, allowedTypes) || undefined
}

function sanitizeEntity(
    value: unknown,
    isCapturedDomId: IsCapturedDomId,
    context: SanitizationContext,
    allowedTypes?: readonly string[]
): Record<string, unknown> | null {
    if (!isObject(value) || !takeNode(context)) {
        return null
    }
    const typeValue = getOwnProperty(value, '@type')
    const types = getEntityTypes(typeValue)
    const typesWithAllowedFields = types.filter(
        (type) => !!getEntityRules(type) && (!allowedTypes || !allowedTypes.length || allowedTypes.includes(type))
    )
    const result: Record<string, unknown> = {}

    for (const property of UNIVERSALLY_ALLOWED_PROPERTIES) {
        const propertyValue =
            property === '@type'
                ? types.length
                    ? typeof typeValue === 'string'
                        ? types[0]
                        : types
                    : undefined
                : property === '@id'
                  ? sanitizeId(getOwnProperty(value, property), isCapturedDomId)
                  : sanitizeScalar(getOwnProperty(value, property), context.maskUrl)
        if (!isUndefined(propertyValue)) {
            setOwnProperty(result, property, propertyValue)
        }
    }

    for (const type of typesWithAllowedFields) {
        const rules = getEntityRules(type)!
        for (const property of Object.keys(rules)) {
            const propertyValue = getOwnProperty(value, property)
            const rule = rules[property]
            if (rule === true) {
                const scalar = sanitizeScalar(propertyValue, context.maskUrl)
                if (!isUndefined(scalar)) {
                    setOwnProperty(result, property, scalar)
                }
            } else {
                const nestedValue = sanitizeEntityValue(propertyValue, isCapturedDomId, context, rule)
                if (!isUndefined(nestedValue)) {
                    setOwnProperty(result, property, nestedValue)
                }
            }
        }
    }

    const graph = sanitizeEntityValue(getOwnProperty(value, '@graph'), isCapturedDomId, context)
    if (!isUndefined(graph)) {
        setOwnProperty(result, '@graph', graph)
    }

    return Object.keys(result).length ? result : null
}

function sanitizeRoot(
    value: unknown,
    isCapturedDomId: IsCapturedDomId,
    context: SanitizationContext
): Record<string, unknown> | null {
    if (!isObject(value)) {
        return null
    }
    const schemaContext = getOwnProperty(value, '@context')
    if (typeof schemaContext !== 'string' || !/^https?:\/\/schema\.org\/?$/.test(schemaContext)) {
        return null
    }

    const entity = sanitizeEntity(value, isCapturedDomId, context)
    return entity ? { '@context': SCHEMA_CONTEXT, ...entity } : null
}

export function sanitizeJsonLd(
    text: string,
    isCapturedDomId: IsCapturedDomId = NO_CAPTURED_DOM_IDS,
    maskUrl?: MaskJsonLdUrl
): [unknown, string] | null {
    if (!text || text.length > MAX_JSON_LD_LENGTH) {
        return null
    }

    try {
        const value: unknown = JSON.parse(text)
        const context: SanitizationContext = {
            maskUrl,
            remainingNodes: MAX_JSON_LD_NODES,
            exceeded: false,
        }
        const sanitized = isArray(value)
            ? value.map((root) => sanitizeRoot(root, isCapturedDomId, context))
            : sanitizeRoot(value, isCapturedDomId, context)
        if (
            context.exceeded ||
            isNull(sanitized) ||
            (isArray(sanitized) && (!sanitized.length || sanitized.some(isNull)))
        ) {
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
    maskUrl?: MaskJsonLdUrl
    attributeFilter?: string[]
    blockClass?: string | RegExp
    blockSelector?: string | null
    isRecordedElement?: (element: Element) => boolean
    maskAllElementAttributes?: boolean
    maskAttributeFn?: ((name: string, value: string, element: Element) => string) | null
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

function isWithinBoundary(element: Element, classRule?: string | RegExp, selector?: string | null): boolean {
    for (let current: Element | null = element; current;) {
        if (matchesPrivacyRule(current, classRule, selector)) {
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

function isWithinPrivacyBoundary(element: Element, options: JsonLdPrivacyOptions): boolean {
    return (
        isWithinBoundary(element, options.blockClass, options.blockSelector) ||
        isWithinBoundary(element, options.maskTextClass, options.maskTextSelector)
    )
}

function createCapturedDomIdMatcher(doc: Document, options: JsonLdPrivacyOptions): IsCapturedDomId {
    const attributeFilter = options.attributeFilter
    if (
        options.maskAllElementAttributes ||
        options.maskAttributeFn ||
        (attributeFilter?.length && !attributeFilter.includes('id'))
    ) {
        return NO_CAPTURED_DOM_IDS
    }

    return (id) => {
        const element = doc.getElementById(id)
        return (
            !!element &&
            element.nodeName !== 'SCRIPT' &&
            (!options.isRecordedElement || options.isRecordedElement(element)) &&
            !isWithinBoundary(element, options.blockClass, options.blockSelector)
        )
    }
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
    const getCaptureState = options.getCaptureState || (() => true)
    let remainingLength = MAX_JSON_LD_LENGTH
    const hasCapturedDomId = createCapturedDomIdMatcher(doc, options)

    const captureScript = (script: HTMLScriptElement): void => {
        try {
            const captureState = getCaptureState()
            if (
                !remainingLength ||
                captureState === false ||
                !script.isConnected ||
                script.ownerDocument !== doc ||
                isWithinPrivacyBoundary(script, options)
            ) {
                return
            }
            const sanitized = sanitizeJsonLd(script.text, hasCapturedDomId, options.maskUrl)
            if (!sanitized) {
                lastJsonByScript.delete(script)
                return
            }
            const [jsonLd, json] = sanitized
            if (isNull(captureState)) {
                lastJsonByScript.set(script, json)
                return
            }
            if (lastJsonByScript.get(script) !== json) {
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
                if (!remainingLength || getCaptureState() === false) {
                    return
                }
                const captureScripts = (node: Node): void => {
                    for (const script of getJsonLdScripts(node)) {
                        captureScript(script)
                    }
                }

                for (const mutation of mutations) {
                    if (mutation.type === 'childList') {
                        if (isJsonLdScript(mutation.target)) {
                            captureScript(mutation.target)
                        }
                        mutation.addedNodes.forEach(captureScripts)
                    } else if (mutation.type === 'characterData') {
                        const parent = mutation.target.parentNode
                        if (parent && isJsonLdScript(parent)) {
                            captureScript(parent)
                        }
                    } else if (mutation.type === 'attributes' && isJsonLdScript(mutation.target)) {
                        captureScript(mutation.target)
                    }
                }
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
            if (!remainingLength || getCaptureState() === false) {
                return
            }
            getJsonLdScripts(doc.documentElement).forEach((script) => {
                if (force) {
                    lastJsonByScript.delete(script)
                }
                captureScript(script)
            })
        }

        return { scan, stop: () => observer.disconnect() }
    } catch {
        return { scan: () => {}, stop: () => {} }
    }
}
