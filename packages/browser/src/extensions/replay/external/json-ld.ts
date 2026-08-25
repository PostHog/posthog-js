import { isArray, isNull, isUndefined } from '@posthog/core'

type JsonLdScalar = string | number | boolean | null
type JsonLdPropertyRule = true | readonly string[]
type JsonLdEntityRules = Record<string, JsonLdPropertyRule>

const MAX_JSON_LD_INPUT_LENGTH = 100_000
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

export const JSON_LD_EVENT_TAG = '$json_ld'

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && !isNull(value) && !isArray(value)
}

function isScalar(value: unknown): value is JsonLdScalar {
    const type = typeof value
    return isNull(value) || type === 'string' || type === 'number' || type === 'boolean'
}

function sanitizeScalar(value: unknown): JsonLdScalar | JsonLdScalar[] | undefined {
    return isScalar(value) || (isArray(value) && value.every(isScalar)) ? value : undefined
}

function sanitizeEntity(value: unknown, allowedTypes?: readonly string[]): Record<string, unknown> | null {
    if (!isObject(value) || typeof value['@type'] !== 'string') {
        return null
    }

    const type = value['@type']
    const rules = ENTITY_RULES[type]
    if (isUndefined(rules) || (allowedTypes && !allowedTypes.includes(type))) {
        return null
    }

    const result: Record<string, unknown> = { '@type': type }
    const id = sanitizeScalar(value['@id'])
    if (!isUndefined(id)) {
        result['@id'] = id
    }

    for (const property of Object.keys(rules)) {
        const propertyValue = value[property]
        const rule = rules[property]
        if (rule === true) {
            const scalar = sanitizeScalar(propertyValue)
            if (!isUndefined(scalar)) {
                result[property] = scalar
            }
        } else if (isArray(propertyValue)) {
            const items = propertyValue
                .map((item) => sanitizeEntity(item, rule))
                .filter((item): item is Record<string, unknown> => !isNull(item))
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

    return result
}

function sanitizeRoot(value: unknown): Record<string, unknown> | null {
    if (
        !isObject(value) ||
        typeof value['@context'] !== 'string' ||
        value['@context'].replace(/^http:/, 'https:').replace(/\/$/, '') !== SCHEMA_CONTEXT
    ) {
        return null
    }

    const entity = sanitizeEntity(value)
    return entity ? { '@context': SCHEMA_CONTEXT, ...entity } : null
}

export function sanitizeJsonLd(text: string): string | null {
    if (!text || text.length > MAX_JSON_LD_INPUT_LENGTH) {
        return null
    }

    try {
        const value: unknown = JSON.parse(text)
        const sanitized = isArray(value) ? value.map(sanitizeRoot) : sanitizeRoot(value)
        if (
            isNull(sanitized) ||
            (isArray(sanitized) && (!sanitized.length || sanitized.some((item) => isNull(item))))
        ) {
            return null
        }

        const output = JSON.stringify(sanitized).replace(/</g, '\\u003c')
        return output.length <= MAX_JSON_LD_OUTPUT_LENGTH ? output : null
    } catch {
        return null
    }
}

function isJsonLdScript(node: Node): node is HTMLScriptElement {
    return (
        node.nodeType === node.ELEMENT_NODE &&
        (node as Element).tagName === 'SCRIPT' &&
        (node as Element).getAttribute('type')?.trim().toLowerCase() === 'application/ld+json'
    )
}

type JsonLdPrivacyOptions = {
    blockClass?: string | RegExp
    blockSelector?: string | null
    maskTextClass?: string | RegExp
    maskTextSelector?: string | null
}

function classMatches(element: Element, rule?: string | RegExp): boolean {
    if (!rule) {
        return false
    }
    if (typeof rule === 'string') {
        return element.classList.contains(rule)
    }
    return Array.from(element.classList).some((className) => {
        rule.lastIndex = 0
        return rule.test(className)
    })
}

function selectorMatches(element: Element, selector?: string | null): boolean {
    try {
        return !!selector && element.matches(selector)
    } catch {
        return false
    }
}

function isWithinPrivacyBoundary(element: Element, options: JsonLdPrivacyOptions): boolean {
    for (let current: Element | null = element; current; current = current.parentElement) {
        if (
            classMatches(current, options.blockClass) ||
            classMatches(current, options.maskTextClass) ||
            selectorMatches(current, options.blockSelector) ||
            selectorMatches(current, options.maskTextSelector)
        ) {
            return true
        }
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
    options: JsonLdPrivacyOptions & { emit: (jsonLd: unknown) => void }
): () => void {
    const lastJsonByScript = new WeakMap<HTMLScriptElement, string>()

    const captureScript = (script: HTMLScriptElement): void => {
        try {
            if (!script.isConnected || isWithinPrivacyBoundary(script, options)) {
                return
            }
            const json = sanitizeJsonLd(script.textContent || '')
            if (!json) {
                lastJsonByScript.delete(script)
                return
            }
            if (lastJsonByScript.get(script) !== json) {
                lastJsonByScript.set(script, json)
                options.emit(JSON.parse(json))
            }
        } catch {
            return
        }
    }

    try {
        const observer = new MutationObserverClass((mutations) => {
            try {
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
                    } else if (mutation.type === 'characterData' && mutation.target.parentNode) {
                        addScripts(mutation.target.parentNode)
                    } else if (mutation.type === 'attributes') {
                        addScripts(mutation.target)
                    }
                }

                scripts.forEach(captureScript)
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
        doc.querySelectorAll('script').forEach((script) => {
            if (isJsonLdScript(script)) {
                captureScript(script)
            }
        })

        return () => observer.disconnect()
    } catch {
        return () => {}
    }
}
