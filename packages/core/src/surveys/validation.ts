import { SurveyValidationRule, SurveyValidationType } from '../types'

/**
 * Validates a survey open text response.
 * Returns an error message string if invalid, or false if valid.
 */
export function getValidationError(
  value: string,
  rules: SurveyValidationRule[] | undefined,
  optional: boolean | undefined
): string | false {
  const trimmed = value.trim()

  // Required check (with whitespace fix) - applies to ALL required questions
  if (!optional && trimmed === '') {
    return 'This field is required'
  }

  // If optional and empty, skip other validations
  if (trimmed === '') {
    return false
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
      }
    }
  }

  return false
}

/**
 * Helper to extract a length value from validation rules by type
 */
export function getLengthFromRules(
  rules: SurveyValidationRule[] | undefined,
  type: SurveyValidationType
): number | undefined {
  if (!rules) return undefined
  const rule = rules.find((r) => r.type === type)
  return rule?.value
}
