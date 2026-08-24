import dom from '@posthog/rrweb-utils';

type JsonLdScalar = string | number | boolean | null;
type JsonLdType =
  | 'Action'
  | 'AggregateOffer'
  | 'AggregateRating'
  | 'Brand'
  | 'CreativeWork'
  | 'Offer'
  | 'Organization'
  | 'Person'
  | 'Place'
  | 'Product';
type JsonLdPropertyRule = true | readonly JsonLdEntityRule[];
type JsonLdTypeRule = Record<string, JsonLdPropertyRule>;
type JsonLdEntityRule = {
  type: JsonLdType;
  properties: JsonLdTypeRule;
};

const MAX_JSON_LD_INPUT_LENGTH = 100_000;
const MAX_JSON_LD_OUTPUT_LENGTH = 20_000;
const SCHEMA_CONTEXT = 'https://schema.org';

const aggregateRatingRule: JsonLdEntityRule = {
  type: 'AggregateRating',
  properties: {
    ratingValue: true,
    ratingCount: true,
    reviewCount: true,
    bestRating: true,
    worstRating: true,
  },
};
const brandRule: JsonLdEntityRule = {
  type: 'Brand',
  properties: { name: true },
};
const nestedOrganizationRule: JsonLdEntityRule = {
  type: 'Organization',
  properties: { name: true },
};
const offerRule: JsonLdEntityRule = {
  type: 'Offer',
  properties: {
    price: true,
    priceCurrency: true,
    priceValidUntil: true,
    availability: true,
    itemCondition: true,
    seller: [nestedOrganizationRule],
  },
};
const aggregateOfferRule: JsonLdEntityRule = {
  type: 'AggregateOffer',
  properties: {
    lowPrice: true,
    highPrice: true,
    priceCurrency: true,
    offerCount: true,
    availability: true,
    offers: [offerRule],
  },
};
const ROOT_RULES: readonly JsonLdEntityRule[] = [
  {
    type: 'Action',
    properties: { actionStatus: true },
  },
  {
    type: 'CreativeWork',
    properties: {
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
      aggregateRating: [aggregateRatingRule],
      publisher: [nestedOrganizationRule],
    },
  },
  {
    type: 'Organization',
    properties: {
      name: true,
      legalName: true,
      foundingDate: true,
      dissolutionDate: true,
      nonprofitStatus: true,
      aggregateRating: [aggregateRatingRule],
      brand: [brandRule],
    },
  },
  {
    type: 'Person',
    properties: {},
  },
  {
    type: 'Place',
    properties: {
      publicAccess: true,
      smokingAllowed: true,
      maximumAttendeeCapacity: true,
      isAccessibleForFree: true,
      aggregateRating: [aggregateRatingRule],
    },
  },
  {
    type: 'Product',
    properties: {
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
      brand: [brandRule, nestedOrganizationRule],
      manufacturer: [nestedOrganizationRule],
      offers: [offerRule, aggregateOfferRule],
      aggregateRating: [aggregateRatingRule],
    },
  },
];

const sanitizedJsonLdScriptCache = new WeakMap<
  Element,
  { text: string; sanitized: string | null }
>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwnProperty(
  value: Record<string, unknown>,
  property: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function sanitizeScalar(
  value: unknown,
): JsonLdScalar | JsonLdScalar[] | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item === null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    )
  ) {
    return value;
  }
  return undefined;
}

function sanitizeEntity(
  value: unknown,
  allowedRules: readonly JsonLdEntityRule[],
): Record<string, unknown> | null {
  if (
    !isObject(value) ||
    !hasOwnProperty(value, '@type') ||
    typeof value['@type'] !== 'string'
  ) {
    return null;
  }

  const entityRule = allowedRules.find((rule) => rule.type === value['@type']);
  if (!entityRule) {
    return null;
  }

  const result: Record<string, unknown> = Object.create(null);
  result['@type'] = entityRule.type;

  for (const property of Object.keys(entityRule.properties)) {
    if (!hasOwnProperty(value, property)) {
      continue;
    }
    const propertyValue = value[property];
    if (propertyValue === undefined) {
      continue;
    }

    const rule = entityRule.properties[property];
    if (rule === true) {
      const scalar = sanitizeScalar(propertyValue);
      if (scalar !== undefined) {
        result[property] = scalar;
      }
      continue;
    }

    if (Array.isArray(propertyValue)) {
      const items = propertyValue
        .map((item) => sanitizeEntity(item, rule))
        .filter((item): item is Record<string, unknown> => item !== null);
      if (items.length) {
        result[property] = items;
      }
      continue;
    }

    const nestedEntity = sanitizeEntity(propertyValue, rule);
    if (nestedEntity) {
      result[property] = nestedEntity;
    }
  }

  return result;
}

function hasSchemaContext(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.replace(/^http:/, 'https:').replace(/\/$/, '') === SCHEMA_CONTEXT
  );
}

function sanitizeRoot(value: unknown): Record<string, unknown> | null {
  if (
    !isObject(value) ||
    !hasOwnProperty(value, '@context') ||
    !hasSchemaContext(value['@context'])
  ) {
    return null;
  }

  const entity = sanitizeEntity(value, ROOT_RULES);
  if (!entity) {
    return null;
  }

  const result: Record<string, unknown> = Object.create(null);
  result['@context'] = SCHEMA_CONTEXT;
  for (const property of Object.keys(entity)) {
    result[property] = entity[property];
  }
  return result;
}

export function sanitizeJsonLd(text: string): string | null {
  if (!text || text.length > MAX_JSON_LD_INPUT_LENGTH) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(text);
    const sanitized = Array.isArray(value)
      ? value.map(sanitizeRoot)
      : sanitizeRoot(value);

    if (
      sanitized === null ||
      (Array.isArray(sanitized) && sanitized.length === 0) ||
      (Array.isArray(sanitized) && sanitized.some((item) => item === null))
    ) {
      return null;
    }

    const output = JSON.stringify(sanitized).replace(/</g, '\\u003c');
    return output.length <= MAX_JSON_LD_OUTPUT_LENGTH ? output : null;
  } catch {
    return null;
  }
}

export function isJsonLdScript(element: Element): boolean {
  return (
    dom.nodeName(element) === 'SCRIPT' &&
    dom.getAttribute(element, 'type')?.trim().toLowerCase() ===
      'application/ld+json'
  );
}

export function sanitizeJsonLdScript(element: Element): string | null {
  if (!isJsonLdScript(element)) {
    return null;
  }

  const text = dom.textContent(element) || '';
  const cached = sanitizedJsonLdScriptCache.get(element);
  if (cached?.text === text) {
    return cached.sanitized;
  }

  const sanitized = sanitizeJsonLd(text);
  sanitizedJsonLdScriptCache.set(element, { text, sanitized });
  return sanitized;
}
