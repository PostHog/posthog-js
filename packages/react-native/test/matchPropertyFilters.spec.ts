import { matchPropertyFilters, PropertyFilters } from '../src/surveys/surveys-utils'
import { SurveyMatchType } from '@posthog/core'

describe('matchPropertyFilters', () => {
  describe('when no property filters are defined', () => {
    it('returns true with undefined filters', () => {
      expect(matchPropertyFilters(undefined, { some_prop: 'value' })).toBe(true)
    })

    it('returns true with empty filters object', () => {
      expect(matchPropertyFilters({}, { some_prop: 'value' })).toBe(true)
    })

    it('returns true with undefined event properties', () => {
      expect(matchPropertyFilters(undefined, undefined)).toBe(true)
    })
  })

  describe('exact operator', () => {
    const filters: PropertyFilters = {
      product_type: { values: ['premium'], operator: SurveyMatchType.Exact },
    }

    it('matches when property value equals target', () => {
      expect(matchPropertyFilters(filters, { product_type: 'premium' })).toBe(true)
    })

    it('does not match when property value differs', () => {
      expect(matchPropertyFilters(filters, { product_type: 'basic' })).toBe(false)
    })

    it('does not match when property is missing', () => {
      expect(matchPropertyFilters(filters, { other_prop: 'value' })).toBe(false)
    })

    it('does not match when property is null', () => {
      expect(matchPropertyFilters(filters, { product_type: null })).toBe(false)
    })

    it('does not match when property is undefined', () => {
      expect(matchPropertyFilters(filters, { product_type: undefined })).toBe(false)
    })

    it('matches any value in the values array', () => {
      const multiValueFilters: PropertyFilters = {
        status: { values: ['active', 'pending'], operator: SurveyMatchType.Exact },
      }
      expect(matchPropertyFilters(multiValueFilters, { status: 'active' })).toBe(true)
      expect(matchPropertyFilters(multiValueFilters, { status: 'pending' })).toBe(true)
      expect(matchPropertyFilters(multiValueFilters, { status: 'inactive' })).toBe(false)
    })
  })

  describe('is_not operator', () => {
    const filters: PropertyFilters = {
      product_type: { values: ['basic'], operator: SurveyMatchType.IsNot },
    }

    it('matches when property value is not the target', () => {
      expect(matchPropertyFilters(filters, { product_type: 'premium' })).toBe(true)
    })

    it('does not match when property value equals target', () => {
      expect(matchPropertyFilters(filters, { product_type: 'basic' })).toBe(false)
    })

    it('does not match when property is missing', () => {
      expect(matchPropertyFilters(filters, { other_prop: 'value' })).toBe(false)
    })

    it('must not equal any value in the values array', () => {
      const multiValueFilters: PropertyFilters = {
        status: { values: ['deleted', 'archived'], operator: SurveyMatchType.IsNot },
      }
      expect(matchPropertyFilters(multiValueFilters, { status: 'active' })).toBe(true)
      expect(matchPropertyFilters(multiValueFilters, { status: 'deleted' })).toBe(false)
      expect(matchPropertyFilters(multiValueFilters, { status: 'archived' })).toBe(false)
    })
  })

  describe('icontains operator', () => {
    const filters: PropertyFilters = {
      query: { values: ['product'], operator: SurveyMatchType.Icontains },
    }

    it('matches when property contains target (case insensitive)', () => {
      expect(matchPropertyFilters(filters, { query: 'new product features' })).toBe(true)
      expect(matchPropertyFilters(filters, { query: 'NEW PRODUCT FEATURES' })).toBe(true)
      expect(matchPropertyFilters(filters, { query: 'Product' })).toBe(true)
    })

    it('does not match when property does not contain target', () => {
      expect(matchPropertyFilters(filters, { query: 'something else' })).toBe(false)
    })
  })

  describe('not_icontains operator', () => {
    const filters: PropertyFilters = {
      query: { values: ['spam'], operator: SurveyMatchType.NotIcontains },
    }

    it('matches when property does not contain target', () => {
      expect(matchPropertyFilters(filters, { query: 'legitimate content' })).toBe(true)
    })

    it('does not match when property contains target (case insensitive)', () => {
      expect(matchPropertyFilters(filters, { query: 'this is SPAM' })).toBe(false)
      expect(matchPropertyFilters(filters, { query: 'spam message' })).toBe(false)
    })
  })

  describe('regex operator', () => {
    const filters: PropertyFilters = {
      url: { values: ['^/app/.*'], operator: SurveyMatchType.Regex },
    }

    it('matches when property matches regex pattern', () => {
      expect(matchPropertyFilters(filters, { url: '/app/dashboard' })).toBe(true)
      expect(matchPropertyFilters(filters, { url: '/app/settings/profile' })).toBe(true)
    })

    it('does not match when property does not match regex', () => {
      expect(matchPropertyFilters(filters, { url: '/home' })).toBe(false)
      expect(matchPropertyFilters(filters, { url: '/other/app/path' })).toBe(false)
    })

    it('handles invalid regex gracefully', () => {
      const invalidRegexFilters: PropertyFilters = {
        value: { values: ['[invalid(regex'], operator: SurveyMatchType.Regex },
      }
      expect(matchPropertyFilters(invalidRegexFilters, { value: 'test' })).toBe(false)
    })
  })

  describe('not_regex operator', () => {
    const filters: PropertyFilters = {
      email: { values: ['.*@test\\.com$'], operator: SurveyMatchType.NotRegex },
    }

    it('matches when property does not match regex pattern', () => {
      expect(matchPropertyFilters(filters, { email: 'user@example.com' })).toBe(true)
    })

    it('does not match when property matches regex', () => {
      expect(matchPropertyFilters(filters, { email: 'user@test.com' })).toBe(false)
    })
  })

  describe('multiple property filters', () => {
    const filters: PropertyFilters = {
      product_type: { values: ['premium'], operator: SurveyMatchType.Exact },
      amount: { values: ['100'], operator: SurveyMatchType.IsNot },
    }

    it('matches when all filters pass', () => {
      expect(matchPropertyFilters(filters, { product_type: 'premium', amount: '200' })).toBe(true)
    })

    it('does not match when first filter fails', () => {
      expect(matchPropertyFilters(filters, { product_type: 'basic', amount: '200' })).toBe(false)
    })

    it('does not match when second filter fails', () => {
      expect(matchPropertyFilters(filters, { product_type: 'premium', amount: '100' })).toBe(false)
    })

    it('does not match when any property is missing', () => {
      expect(matchPropertyFilters(filters, { product_type: 'premium' })).toBe(false)
      expect(matchPropertyFilters(filters, { amount: '200' })).toBe(false)
    })
  })

  describe('type coercion', () => {
    it('converts number property values to strings', () => {
      const filters: PropertyFilters = {
        count: { values: ['5'], operator: SurveyMatchType.Exact },
      }
      expect(matchPropertyFilters(filters, { count: 5 })).toBe(true)
    })

    it('converts boolean property values to strings', () => {
      const filters: PropertyFilters = {
        enabled: { values: ['true'], operator: SurveyMatchType.Exact },
      }
      expect(matchPropertyFilters(filters, { enabled: true })).toBe(true)
    })
  })

  describe('gt operator (numeric)', () => {
    const filters: PropertyFilters = {
      amount: { values: ['5'], operator: 'gt' },
    }

    it('matches when numeric value is greater than target', () => {
      expect(matchPropertyFilters(filters, { amount: 10 })).toBe(true)
      expect(matchPropertyFilters(filters, { amount: 6 })).toBe(true)
      expect(matchPropertyFilters(filters, { amount: '10' })).toBe(true)
    })

    it('does not match when numeric value equals target', () => {
      expect(matchPropertyFilters(filters, { amount: 5 })).toBe(false)
    })

    it('does not match when numeric value is less than target', () => {
      expect(matchPropertyFilters(filters, { amount: 3 })).toBe(false)
      expect(matchPropertyFilters(filters, { amount: 0 })).toBe(false)
    })

    it('does not match for non-numeric values', () => {
      expect(matchPropertyFilters(filters, { amount: 'not a number' })).toBe(false)
    })
  })

  describe('lt operator (numeric)', () => {
    const filters: PropertyFilters = {
      amount: { values: ['10'], operator: 'lt' },
    }

    it('matches when numeric value is less than target', () => {
      expect(matchPropertyFilters(filters, { amount: 5 })).toBe(true)
      expect(matchPropertyFilters(filters, { amount: 0 })).toBe(true)
      expect(matchPropertyFilters(filters, { amount: '3' })).toBe(true)
    })

    it('does not match when numeric value equals target', () => {
      expect(matchPropertyFilters(filters, { amount: 10 })).toBe(false)
    })

    it('does not match when numeric value is greater than target', () => {
      expect(matchPropertyFilters(filters, { amount: 15 })).toBe(false)
      expect(matchPropertyFilters(filters, { amount: 100 })).toBe(false)
    })
  })
})
