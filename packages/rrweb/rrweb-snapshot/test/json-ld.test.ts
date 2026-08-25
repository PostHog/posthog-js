import { describe, expect, it } from 'vitest';
import { sanitizeJsonLd } from '../src/json-ld';

describe('sanitizeJsonLd', () => {
  it('rebuilds product data from type-specific rules', () => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify({
        '@context': 'http://schema.org/',
        '@type': 'Product',
        name: 'Canvas shoes',
        email: 'customer@example.com',
        image: { email: 'image-owner@example.com' },
        brand: {
          '@type': 'Brand',
          name: 'Acme',
          email: 'brand-owner@example.com',
        },
        offers: {
          '@type': 'Offer',
          price: 25,
          priceCurrency: 'GBP',
          customer: { name: 'Private customer' },
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: 4.8,
          reviewCount: 12,
          reviewer: { name: 'Private reviewer' },
        },
      }),
    );

    expect(JSON.parse(sanitized!)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Canvas shoes',
      brand: {
        '@type': 'Brand',
        name: 'Acme',
      },
      offers: {
        '@type': 'Offer',
        price: 25,
        priceCurrency: 'GBP',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: 4.8,
        reviewCount: 12,
      },
    });
    expect(sanitized).not.toContain('customer@example.com');
    expect(sanitized).not.toContain('Private customer');
    expect(sanitized).not.toContain('Private reviewer');
  });

  it('supports arrays when every root has an approved type', () => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify([
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'First product',
        },
        {
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: 'Private person',
        },
      ]),
    );

    expect(JSON.parse(sanitized!)).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'First product',
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Person',
      },
    ]);
  });

  it('rebuilds approved scalar and entity arrays', () => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        category: ['Shoes', 'Sale'],
        brand: {
          '@type': 'Organization',
          name: 'Acme',
        },
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: 20,
          highPrice: 30,
          offers: [
            {
              '@type': 'Offer',
              price: 25,
              customerEmail: 'customer@example.com',
            },
            {
              '@type': 'Person',
              name: 'Private customer',
            },
          ],
        },
      }),
    );

    expect(JSON.parse(sanitized!)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      category: ['Shoes', 'Sale'],
      brand: {
        '@type': 'Organization',
        name: 'Acme',
      },
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: 20,
        highPrice: 30,
        offers: [
          {
            '@type': 'Offer',
            price: 25,
          },
        ],
      },
    });
  });

  it('keeps only scalar leaf values and scalar arrays', () => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: { value: 'Private nested value' },
        sku: null,
        color: true,
        size: 10,
        category: ['Shoes', 2, false, null],
        material: ['Cotton', { value: 'Private nested value' }],
      }),
    );

    expect(JSON.parse(sanitized!)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      sku: null,
      color: true,
      size: 10,
      category: ['Shoes', 2, false, null],
    });
  });

  it('drops an array when any root has an unsupported type', () => {
    expect(
      sanitizeJsonLd(
        JSON.stringify([
          {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: 'Public product',
          },
          {
            '@context': 'https://schema.org',
            '@type': 'Event',
            name: 'Private event',
          },
        ]),
      ),
    ).toBeNull();
  });

  it.each([
    ['invalid JSON', '{'],
    ['missing context', '{"@type":"Product"}'],
    [
      'unsupported context',
      '{"@context":"https://example.com","@type":"Product"}',
    ],
    [
      'unsupported root type',
      '{"@context":"https://schema.org","@type":"Event","name":"Private"}',
    ],
    ['empty root array', '[]'],
  ])('drops %s', (_case, value) => {
    expect(sanitizeJsonLd(value)).toBeNull();
  });

  it('drops empty and oversized input before parsing', () => {
    expect(sanitizeJsonLd('')).toBeNull();
    expect(sanitizeJsonLd(' '.repeat(100_001))).toBeNull();
  });

  it('drops output that exceeds the replay metadata limit after escaping', () => {
    expect(
      sanitizeJsonLd(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: '<'.repeat(4_000),
        }),
      ),
    ).toBeNull();
  });

  it.each([
    [
      'Action',
      {
        actionStatus: 'https://schema.org/CompletedActionStatus',
        agent: 'Private person',
      },
      { actionStatus: 'https://schema.org/CompletedActionStatus' },
    ],
    [
      'AggregateOffer',
      { lowPrice: 20, highPrice: 30, customerEmail: 'private@example.com' },
      { lowPrice: 20, highPrice: 30 },
    ],
    [
      'AggregateRating',
      { ratingValue: 4.8, reviewCount: 12, reviewer: 'Private person' },
      { ratingValue: 4.8, reviewCount: 12 },
    ],
    [
      'Brand',
      { name: 'Acme', email: 'private@example.com' },
      { name: 'Acme' },
    ],
    [
      'CreativeWork',
      { genre: 'Documentation', inLanguage: 'en', author: 'Private person' },
      { genre: 'Documentation', inLanguage: 'en' },
    ],
    [
      'Offer',
      { price: 25, priceCurrency: 'GBP', customer: 'Private person' },
      { price: 25, priceCurrency: 'GBP' },
    ],
    [
      'Organization',
      { name: 'Acme', legalName: 'Acme Ltd', email: 'private@example.com' },
      { name: 'Acme', legalName: 'Acme Ltd' },
    ],
    ['Person', { name: 'Private person', email: 'private@example.com' }, {}],
    [
      'Place',
      { publicAccess: true, name: 'Private home', address: 'Private address' },
      { publicAccess: true },
    ],
    [
      'Product',
      {
        name: 'Canvas shoes',
        category: 'Footwear',
        description: 'Private description',
        url: 'https://example.com/?email=private@example.com',
      },
      { name: 'Canvas shoes', category: 'Footwear' },
    ],
  ])('uses type-specific property rules for %s', (type, properties, expected) => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': type,
        ...properties,
      }),
    );

    expect(JSON.parse(sanitized!)).toEqual({
      '@context': 'https://schema.org',
      '@type': type,
      ...expected,
    });
  });

  it('uses the same organization rule at every depth', () => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        manufacturer: {
          '@type': 'Organization',
          name: 'Acme',
          legalName: 'Acme Subsidiary Ltd',
          nonprofitStatus: 'Nonprofit501c3',
          email: 'private@example.com',
        },
      }),
    );

    expect(JSON.parse(sanitized!)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      manufacturer: {
        '@type': 'Organization',
        name: 'Acme',
        legalName: 'Acme Subsidiary Ltd',
        nonprofitStatus: 'Nonprofit501c3',
      },
    });
  });

  it('escapes markup characters in the serialized JSON', () => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: '</noscript><script>globalThis.executed = true</script>',
      }),
    );

    expect(sanitized).not.toContain('<');
    expect(JSON.parse(sanitized!).name).toBe(
      '</noscript><script>globalThis.executed = true</script>',
    );
  });

  it('does not copy prototype keys', () => {
    const sanitized = sanitizeJsonLd(
      '{"@context":"https://schema.org","@type":"Product","name":"Safe","__proto__":{"polluted":true},"constructor":{"name":"Private"}}',
    );

    expect(JSON.parse(sanitized!)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Safe',
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('does not read allowed properties from Object.prototype', () => {
    const contextDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '@context',
    );
    const typeDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '@type',
    );
    const nameDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'name',
    );
    Object.defineProperties(Object.prototype, {
      '@context': { configurable: true, value: 'https://schema.org' },
      '@type': { configurable: true, value: 'Product' },
      name: { configurable: true, value: 'Private inherited name' },
    });

    try {
      expect(sanitizeJsonLd('{}')).toBeNull();
      expect(
        JSON.parse(
          sanitizeJsonLd(
            '{"@context":"https://schema.org","@type":"Product"}',
          )!,
        ),
      ).toEqual({
        '@context': 'https://schema.org',
        '@type': 'Product',
      });
    } finally {
      for (const [property, descriptor] of [
        ['@context', contextDescriptor],
        ['@type', typeDescriptor],
        ['name', nameDescriptor],
      ] as const) {
        if (descriptor) {
          Object.defineProperty(Object.prototype, property, descriptor);
        } else {
          delete (Object.prototype as Record<string, unknown>)[property];
        }
      }
    }
  });
});
