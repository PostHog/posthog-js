import { getValidationError, getMinLengthFromRules, getMaxLengthFromRules } from './validation'
import { SurveyValidationType, SurveyValidationRule } from '../types'

describe('getValidationError', () => {
  describe('required field (trim fix)', () => {
    it('returns error for empty string when required', () => {
      expect(getValidationError('', undefined, false)).toBe('This field is required')
    })

    it('returns error for whitespace-only when required', () => {
      expect(getValidationError('   ', undefined, false)).toBe('This field is required')
      expect(getValidationError('\t\n', undefined, false)).toBe('This field is required')
    })

    it('returns empty for valid content when required', () => {
      expect(getValidationError('hello', undefined, false)).toBe('')
    })

    it('returns empty for empty when optional', () => {
      expect(getValidationError('', undefined, true)).toBe('')
    })

    it('returns empty for whitespace when optional', () => {
      expect(getValidationError('   ', undefined, true)).toBe('')
    })
  })

  describe('backwards compat - no validation rules', () => {
    it('works when validation is undefined', () => {
      expect(getValidationError('hello', undefined, false)).toBe('')
    })

    it('works when validation is empty array', () => {
      expect(getValidationError('hello', [], false)).toBe('')
    })
  })

  describe('minLength validation', () => {
    const rules: SurveyValidationRule[] = [{ type: SurveyValidationType.MinLength, value: 5 }]

    it('returns error when too short', () => {
      expect(getValidationError('abc', rules, false)).toBe('Please enter at least 5 characters')
    })

    it('returns empty when exact length', () => {
      expect(getValidationError('abcde', rules, false)).toBe('')
    })

    it('returns empty when longer than min', () => {
      expect(getValidationError('abcdefgh', rules, false)).toBe('')
    })

    it('uses custom error message if provided', () => {
      const customRules: SurveyValidationRule[] = [
        { type: SurveyValidationType.MinLength, value: 5, errorMessage: 'Too short!' },
      ]
      expect(getValidationError('abc', customRules, false)).toBe('Too short!')
    })
  })

  describe('maxLength validation', () => {
    const rules: SurveyValidationRule[] = [{ type: SurveyValidationType.MaxLength, value: 10 }]

    it('returns error when too long', () => {
      expect(getValidationError('12345678901', rules, false)).toBe('Please enter no more than 10 characters')
    })

    it('returns empty when exact length', () => {
      expect(getValidationError('1234567890', rules, false)).toBe('')
    })

    it('returns empty when shorter than max', () => {
      expect(getValidationError('12345', rules, false)).toBe('')
    })
  })

  describe('minLength + maxLength combined', () => {
    const rules: SurveyValidationRule[] = [
      { type: SurveyValidationType.MinLength, value: 5 },
      { type: SurveyValidationType.MaxLength, value: 10 },
    ]

    it('fails when too short', () => {
      expect(getValidationError('abc', rules, false)).toContain('at least 5')
    })

    it('fails when too long', () => {
      expect(getValidationError('12345678901', rules, false)).toContain('no more than 10')
    })

    it('passes when in range', () => {
      expect(getValidationError('1234567', rules, false)).toBe('')
    })
  })
})

describe('getMinLengthFromRules', () => {
  it('returns undefined when no rules', () => {
    expect(getMinLengthFromRules(undefined)).toBeUndefined()
  })

  it('returns undefined when no minLength rule', () => {
    expect(getMinLengthFromRules([{ type: SurveyValidationType.MaxLength, value: 10 }])).toBeUndefined()
  })

  it('returns value when minLength rule exists', () => {
    expect(getMinLengthFromRules([{ type: SurveyValidationType.MinLength, value: 5 }])).toBe(5)
  })
})

describe('getMaxLengthFromRules', () => {
  it('returns undefined when no rules', () => {
    expect(getMaxLengthFromRules(undefined)).toBeUndefined()
  })

  it('returns value when maxLength rule exists', () => {
    expect(getMaxLengthFromRules([{ type: SurveyValidationType.MaxLength, value: 100 }])).toBe(100)
  })
})
