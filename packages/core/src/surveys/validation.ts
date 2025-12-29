import { SurveyValidationRule, SurveyValidationType } from '../types'

/**
 * Validates an email address using a simple linear-time check.
 * Avoids regex to prevent ReDoS vulnerabilities (polynomial backtracking).
 * Checks: exactly one @, non-empty local part, domain has at least one dot
 * not at start/end.
 */
function isValidEmail(email: string): boolean {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return false // @ must exist and not be first char
  if (email.lastIndexOf('@') !== atIndex) return false // only one @
  const domain = email.slice(atIndex + 1)
  if (domain.length === 0) return false // domain must not be empty
  const dotIndex = domain.indexOf('.')
  if (dotIndex <= 0 || dotIndex === domain.length - 1) return false // dot must exist in domain, not first or last
  return true
}

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
          if (!isValidEmail(trimmed)) {
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
