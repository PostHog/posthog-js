import dom from '@posthog/rrweb-utils';

type JsonLdScalar = string | number | boolean | null;
type JsonLdType =
  | 'Product'
  | 'Brand'
  | 'Organization'
  | 'Offer'
  | 'AggregateOffer'
  | 'AggregateRating';
type JsonLdPropertyRule = true | readonly JsonLdType[];
type JsonLdTypeRule = Record<string, JsonLdPropertyRule>;

const MAX_JSON_LD_LENGTH = 100_000;
const SCHEMA_CONTEXT = 'https://schema.org';
const ROOT_TYPES: readonly JsonLdType[] = ['Product'];

const JSON_LD_RULES: Record<JsonLdType, JsonLdTypeRule> = {
  Product: {
    name: true,
    description: true,
    image: true,
    url: true,
    sku: true,
    mpn: true,
    gtin: true,
    gtin8: true,
    gtin12: true,
    gtin13: true,
    gtin14: true,
    productID: true,
    category: true,
    color: true,
    material: true,
    pattern: true,
    size: true,
    brand: ['Brand', 'Organization'],
    offers: ['Offer', 'AggregateOffer'],
    aggregateRating: ['AggregateRating'],
  },
  Brand: {
    name: true,
  },
  Organization: {
    name: true,
  },
  Offer: {
    price: true,
    priceCurrency: true,
    availability: true,
    itemCondition: true,
    url: true,
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
};
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
  allowedTypes: readonly JsonLdType[],
): Record<string, unknown> | null {
  if (
    !isObject(value) ||
    !hasOwnProperty(value, '@type') ||
    typeof value['@type'] !== 'string'
  ) {
    return null;
  }

  const type = value['@type'] as JsonLdType;
  const rules = allowedTypes.includes(type) ? JSON_LD_RULES[type] : undefined;
  if (!rules) {
    return null;
  }

  const result: Record<string, unknown> = Object.create(null);
  result['@type'] = type;

  for (const property of Object.keys(rules)) {
    if (!hasOwnProperty(value, property)) {
      continue;
    }
    const propertyValue = value[property];
    if (propertyValue === undefined) {
      continue;
    }

    const rule = rules[property];
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

  const entity = sanitizeEntity(value, ROOT_TYPES);
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
  if (!text || text.length > MAX_JSON_LD_LENGTH) {
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

    return JSON.stringify(sanitized).replace(/</g, '\\u003c');
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
