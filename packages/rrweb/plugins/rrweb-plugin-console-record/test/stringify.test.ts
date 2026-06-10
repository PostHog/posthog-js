/**
 * @vitest-environment jsdom
 */

import { stringify } from '../src/stringify';
import { describe, it, expect } from 'vitest';

describe('stringify', () => {
  it('can stringify bigint', () => {
    expect(stringify(BigInt(1))).toEqual('"1n"');
  });

  it('can stringify a Proxy that throws on Symbol property access', () => {
    const target = { foo: 'bar', nested: { baz: 123 } };
    const proxy = new Proxy(target, {
      get(obj, prop) {
        if (typeof prop === 'symbol') {
          throw new ReferenceError('Cannot access Symbol properties');
        }
        return Reflect.get(obj, prop);
      },
    });

    expect(() => stringify(proxy)).not.toThrow();
    expect(stringify(proxy)).toEqual('{"foo":"bar","nested":{"baz":123}}');
  });

  describe('handles different types correctly', () => {
    it('stringifies plain objects as objects', () => {
      expect(stringify({ a: 1 })).toBe('{"a":1}');
      expect(stringify({ nested: { deep: true } })).toBe(
        '{"nested":{"deep":true}}',
      );
    });

    it('stringifies Object.create(null) as object', () => {
      const nullProto = Object.create(null);
      nullProto.key = 'value';
      expect(stringify(nullProto)).toBe('{"key":"value"}');
    });

    it('stringifies arrays as arrays', () => {
      expect(stringify([])).toBe('[]');
      expect(stringify([1, 2, 3])).toBe('[1,2,3]');
    });

    it('stringifies null as null', () => {
      expect(stringify(null)).toBe('null');
    });

    it('stringifies undefined as "undefined"', () => {
      expect(stringify(undefined)).toBe('"undefined"');
    });

    it('stringifies strings as strings', () => {
      expect(stringify('hello')).toBe('"hello"');
    });

    it('stringifies numbers as numbers', () => {
      expect(stringify(123)).toBe('123');
    });

    it('stringifies dates to ISO string', () => {
      const result = stringify(new Date('2024-01-01T00:00:00.000Z'));
      expect(result).toBe('"2024-01-01T00:00:00.000Z"');
    });

    it('stringifies functions using toString', () => {
      function testFn() {
        return 'test';
      }
      const result = stringify(testFn);
      expect(result).toContain('test');
    });

    it('stringifies Map as empty object', () => {
      expect(stringify(new Map())).toBe('{}');
    });

    it('stringifies Set as empty object', () => {
      expect(stringify(new Set())).toBe('{}');
    });
  });
});
