import { SurveyValidationRule, SurveyValidationType } from '../types'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validates a survey open text response.
 * Returns an error message string if invalid, or empty string if valid.
 */
export function getValidationError(
  value: string,
  rules: SurveyValidationRule[] | undefined,
  optional: boolean | undefined
): string {
  const trimmed = value.trim()

  // Required check (with whitespace fix) - applies to ALL required questions
  if (!optional && trimmed === '') {
    return 'This field is required'
  }

  // If optional and empty, skip other validations
  if (trimmed === '') {
    return ''
  }

  // Apply validation rules (only if configured)
  if (rules && rules.length > 0) {
    for (const rule of rules) {
      switch (rule.type) {
        case SurveyValidationType.MinLength:
          if (rule.value !== undefined && trimmed.length < rule.value) {
            return rule.errorMessage ?? `Please enter at least ${rule.value} characters`
          }
          break

        case SurveyValidationType.MaxLength:
          if (rule.value !== undefined && trimmed.length > rule.value) {
            return rule.errorMessage ?? `Please enter no more than ${rule.value} characters`
          }
          break

        case SurveyValidationType.Email:
          if (!EMAIL_REGEX.test(trimmed)) {
            return rule.errorMessage ?? 'Please enter a valid email address'
          }
          break
      }
    }
  }

  return '' // Valid
}

/**
 * Helper to extract minLength value from validation rules
 */
export function getMinLengthFromRules(rules: SurveyValidationRule[] | undefined): number | undefined {
  if (!rules) return undefined
  const rule = rules.find((r) => r.type === SurveyValidationType.MinLength)
  return rule?.value
}

/**
 * Helper to extract maxLength value from validation rules
 */
export function getMaxLengthFromRules(rules: SurveyValidationRule[] | undefined): number | undefined {
  if (!rules) return undefined
  const rule = rules.find((r) => r.type === SurveyValidationType.MaxLength)
  return rule?.value
}
