import { getValidationError, SurveyValidationType } from '@posthog/core'

describe('Survey Validation in React Native', () => {
  describe('trim fix for required fields', () => {
    it('rejects whitespace-only for required fields', () => {
      expect(getValidationError('   ', undefined, false)).toBe('This field is required')
    })

    it('accepts valid content for required fields', () => {
      expect(getValidationError('hello', undefined, false)).toBe(false)
    })

    it('accepts empty for optional fields', () => {
      expect(getValidationError('', undefined, true)).toBe(false)
    })
  })

  describe('backwards compatibility', () => {
    it('handles surveys without validation field', () => {
      expect(getValidationError('hello', undefined, false)).toBe(false)
    })

    it('handles empty validation array', () => {
      expect(getValidationError('hello', [], false)).toBe(false)
    })
  })

  describe('validation rules', () => {
    it('validates minLength', () => {
      const rules = [{ type: SurveyValidationType.MinLength, value: 5 }]
      expect(getValidationError('abc', rules, false)).toContain('at least 5')
      expect(getValidationError('abcdef', rules, false)).toBe(false)
    })

    it('validates maxLength', () => {
      const rules = [{ type: SurveyValidationType.MaxLength, value: 10 }]
      expect(getValidationError('12345678901', rules, false)).toContain('no more than 10')
      expect(getValidationError('12345', rules, false)).toBe(false)
    })
  })
})
