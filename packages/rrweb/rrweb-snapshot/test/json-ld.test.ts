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

  it('does not allow name outside an approved type path', () => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Public product',
        brand: {
          '@type': 'Person',
          name: 'Private person',
        },
      }),
    );

    expect(JSON.parse(sanitized!)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Public product',
    });
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
          '@type': 'Product',
          name: 'Second product',
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
        '@type': 'Product',
        name: 'Second product',
      },
    ]);
  });

  it('rebuilds approved scalar and entity arrays', () => {
    const sanitized = sanitizeJsonLd(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        image: [
          'https://example.com/front.jpg',
          'https://example.com/back.jpg',
        ],
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
      image: ['https://example.com/front.jpg', 'https://example.com/back.jpg'],
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
            '@type': 'Person',
            name: 'Private person',
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
      '{"@context":"https://schema.org","@type":"Person","name":"Private"}',
    ],
    ['empty root array', '[]'],
  ])('drops %s', (_case, value) => {
    expect(sanitizeJsonLd(value)).toBeNull();
  });

  it('drops empty and oversized input before parsing', () => {
    expect(sanitizeJsonLd('')).toBeNull();
    expect(sanitizeJsonLd(' '.repeat(100_001))).toBeNull();
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
