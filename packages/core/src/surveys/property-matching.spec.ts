import type { PropertyFilters, PropertyOperator } from '../types'
import { isMatchingRegex, isValidRegex, matchPropertyFilters, propertyComparisons } from './property-matching'

const operators: PropertyOperator[] = [
  'exact',
  'is_not',
  'regex',
  'not_regex',
  'icontains',
  'not_icontains',
  'gt',
  'lt',
]

const filter = (operator: PropertyOperator, values: string[]): PropertyFilters => ({
  property: { operator, values },
})

describe('shared property matching contract', () => {
  describe('regex validation', () => {
    it('validates and matches regular expressions without throwing', () => {
      expect(isValidRegex('^/docs/.*')).toBe(true)
      expect(isMatchingRegex('/docs/getting-started', '^/docs/')).toBe(true)
      expect(isMatchingRegex('/pricing', '^/docs/')).toBe(false)
    })

    it('returns false for invalid regular expressions', () => {
      expect(isValidRegex('[invalid')).toBe(false)
      expect(isMatchingRegex('anything', '[invalid')).toBe(false)
    })
  })

  describe('property comparisons', () => {
    it.each<{
      operator: PropertyOperator
      targets: string[]
      values: string[]
      expected: boolean
    }>([
      { operator: 'exact', targets: ['premium'], values: ['basic', 'premium'], expected: true },
      { operator: 'exact', targets: ['premium'], values: ['basic', 'trial'], expected: false },
      { operator: 'is_not', targets: ['basic', 'trial'], values: ['premium', 'enterprise'], expected: true },
      { operator: 'is_not', targets: ['basic', 'trial'], values: ['premium', 'trial'], expected: false },
      { operator: 'regex', targets: ['^/app/', '^/docs/'], values: ['/home', '/docs/start'], expected: true },
      { operator: 'regex', targets: ['^/app/', '^/docs/'], values: ['/home', '/pricing'], expected: false },
      { operator: 'not_regex', targets: ['^/app/', '^/docs/'], values: ['/home', '/pricing'], expected: true },
      { operator: 'not_regex', targets: ['^/app/', '^/docs/'], values: ['/home', '/docs/start'], expected: false },
      { operator: 'icontains', targets: ['CHECKOUT'], values: ['home', 'Start Checkout'], expected: true },
      { operator: 'icontains', targets: ['CHECKOUT'], values: ['home', 'pricing'], expected: false },
      { operator: 'not_icontains', targets: ['SPAM', 'BOT'], values: ['welcome', 'human'], expected: true },
      { operator: 'not_icontains', targets: ['SPAM', 'BOT'], values: ['welcome', 'chatBot'], expected: false },
      { operator: 'gt', targets: ['10', '20'], values: ['9', '21'], expected: true },
      { operator: 'gt', targets: ['10', '20'], values: ['8', '9'], expected: false },
      { operator: 'lt', targets: ['10', '20'], values: ['21', '9'], expected: true },
      { operator: 'lt', targets: ['10', '20'], values: ['20', '21'], expected: false },
    ])('$operator preserves its array quantifier semantics', ({ operator, targets, values, expected }) => {
      expect(propertyComparisons[operator](targets, values)).toBe(expected)
    })

    it.each<{
      operator: PropertyOperator
      expected: boolean
    }>([
      { operator: 'exact', expected: false },
      { operator: 'is_not', expected: true },
      { operator: 'regex', expected: false },
      { operator: 'not_regex', expected: true },
      { operator: 'icontains', expected: false },
      { operator: 'not_icontains', expected: true },
      { operator: 'gt', expected: false },
      { operator: 'lt', expected: false },
    ])('$operator preserves empty-target behavior', ({ operator, expected }) => {
      expect(propertyComparisons[operator]([], ['value'])).toBe(expected)
    })

    it('preserves parseFloat numeric coercion', () => {
      expect(propertyComparisons.gt(['9widgets'], ['10items'])).toBe(true)
      expect(propertyComparisons.lt(['10items'], ['9widgets'])).toBe(true)
      expect(propertyComparisons.gt(['9'], ['not a number'])).toBe(false)
      expect(propertyComparisons.gt(['not a number'], ['10'])).toBe(false)
      expect(propertyComparisons.lt(['10'], ['10items'])).toBe(false)
    })

    it('treats invalid regexes as non-matches before applying negative quantifiers', () => {
      expect(propertyComparisons.regex(['[invalid'], ['value'])).toBe(false)
      expect(propertyComparisons.not_regex(['[invalid'], ['value'])).toBe(true)
    })
  })

  describe('map-level matching', () => {
    it('matches absent and empty filter maps', () => {
      expect(matchPropertyFilters(undefined, undefined)).toBe(true)
      expect(matchPropertyFilters({}, undefined)).toBe(true)
    })

    it('requires every configured property filter to match', () => {
      expect(
        matchPropertyFilters(
          {
            plan: { values: ['premium'], operator: 'exact' },
            role: { values: ['admin'], operator: 'is_not' },
          },
          { plan: 'premium', role: 'member' }
        )
      ).toBe(true)
      expect(
        matchPropertyFilters(
          {
            plan: { values: ['premium'], operator: 'exact' },
            role: { values: ['admin'], operator: 'is_not' },
          },
          { plan: 'premium', role: 'admin' }
        )
      ).toBe(false)
    })

    it.each(operators)('rejects missing and null values for %s, including negative operators', (operator) => {
      expect(matchPropertyFilters(filter(operator, ['target']), {})).toBe(false)
      expect(matchPropertyFilters(filter(operator, ['target']), { property: undefined })).toBe(false)
      expect(matchPropertyFilters(filter(operator, ['target']), { property: null })).toBe(false)
    })

    it('coerces each event property to one string value', () => {
      expect(matchPropertyFilters(filter('exact', ['5']), { property: 5 })).toBe(true)
      expect(matchPropertyFilters(filter('exact', ['true']), { property: true })).toBe(true)
      expect(matchPropertyFilters(filter('exact', ['premium,vip']), { property: ['premium', 'vip'] })).toBe(true)
    })

    it.each<{
      operator: PropertyOperator
      value: string
      expected: boolean
    }>([
      { operator: 'exact', value: 'target', expected: true },
      { operator: 'is_not', value: 'other', expected: true },
      { operator: 'regex', value: '/docs/start', expected: true },
      { operator: 'not_regex', value: '/pricing', expected: true },
      { operator: 'icontains', value: 'TARGET value', expected: true },
      { operator: 'not_icontains', value: 'other value', expected: true },
      { operator: 'gt', value: '11items', expected: true },
      { operator: 'lt', value: '9items', expected: true },
    ])('uses the shared $operator comparison', ({ operator, value, expected }) => {
      const target =
        operator === 'regex' || operator === 'not_regex'
          ? '^/docs/'
          : operator === 'gt' || operator === 'lt'
            ? '10items'
            : 'target'
      expect(matchPropertyFilters(filter(operator, [target]), { property: value })).toBe(expected)
    })

    it('returns false for invalid regex and numeric targets', () => {
      expect(matchPropertyFilters(filter('regex', ['[invalid']), { property: 'value' })).toBe(false)
      expect(matchPropertyFilters(filter('gt', ['not a number']), { property: '10' })).toBe(false)
      expect(matchPropertyFilters(filter('lt', ['not a number']), { property: '10' })).toBe(false)
    })

    it('preserves empty-target behavior through the map matcher', () => {
      expect(matchPropertyFilters(filter('exact', []), { property: 'value' })).toBe(false)
      expect(matchPropertyFilters(filter('regex', []), { property: 'value' })).toBe(false)
      expect(matchPropertyFilters(filter('icontains', []), { property: 'value' })).toBe(false)
      expect(matchPropertyFilters(filter('gt', []), { property: '10' })).toBe(false)
      expect(matchPropertyFilters(filter('lt', []), { property: '10' })).toBe(false)
      expect(matchPropertyFilters(filter('is_not', []), { property: 'value' })).toBe(true)
      expect(matchPropertyFilters(filter('not_regex', []), { property: 'value' })).toBe(true)
      expect(matchPropertyFilters(filter('not_icontains', []), { property: 'value' })).toBe(true)
    })

    it('returns false for an unknown operator from malformed remote data', () => {
      const malformedFilters = filter('unknown' as PropertyOperator, ['target'])
      expect(matchPropertyFilters(malformedFilters, { property: 'target' })).toBe(false)
    })
  })
})
