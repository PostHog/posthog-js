import {
  canSurveyActivateRepeatedly,
  doesSurveyActivateByEvent,
  getSurveyIterationKey,
  propertyComparisons,
} from '@posthog/core/surveys'
import { currentDeviceType } from '../native-deps'
import { FeatureFlagValue, Survey, SurveyMatchType } from '@posthog/core'

const ANY_FLAG_VARIANT = 'any'

function defaultMatchType(matchType?: SurveyMatchType): SurveyMatchType {
  return matchType ?? SurveyMatchType.Icontains
}

function doesSurveyDeviceTypesMatch(survey: Survey): boolean {
  if (!survey.conditions?.deviceTypes || survey.conditions.deviceTypes.length === 0) {
    return true
  }

  return propertyComparisons[defaultMatchType(survey.conditions.deviceTypesMatchType)](survey.conditions.deviceTypes, [
    currentDeviceType,
  ])
}

function isSurveyFlagEnabled(flagKey: string | undefined, flags: Record<string, FeatureFlagValue>): boolean {
  return flagKey ? !!flags[flagKey] === true : true
}

// Same rule as hasPeriodPassed in @posthog/browser-common, so every SDK agrees on the boundary day
function hasPeriodPassed(periodDays?: number, lastSeenDate?: Date): boolean {
  if (!periodDays || !lastSeenDate) {
    return true
  }

  const diffMs = Math.abs(Date.now() - lastSeenDate.getTime())
  const diffDays = Math.ceil(diffMs / (1000 * 3600 * 24))
  return diffDays > periodDays
}

export function getActiveMatchingSurveys(
  surveys: Survey[],
  flags: Record<string, FeatureFlagValue>,
  seenSurveys: string[],
  activatedSurveys: ReadonlySet<string>,
  inProgressSurveys: ReadonlySet<string> = new Set(),
  lastSeenSurveyDate?: Date
): Survey[] {
  return surveys.filter((survey: Survey) => {
    const hasProgress = inProgressSurveys.has(getSurveyIterationKey(survey))
    // Is Active
    if (!survey.start_date || survey.end_date) {
      return false
    }

    // device type check
    if (!doesSurveyDeviceTypesMatch(survey)) {
      return false
    }

    if (seenSurveys.includes(getSurveyIterationKey(survey)) && !canSurveyActivateRepeatedly(survey) && !hasProgress) {
      return false
    }

    if (!hasPeriodPassed(survey.conditions?.seenSurveyWaitPeriodInDays, lastSeenSurveyDate)) {
      return false
    }

    // Skip surveys with URL or CSS selector conditions (not supported in React Native)
    if (
      (survey.conditions?.url && survey.conditions.url !== '') ||
      (survey.conditions?.selector && survey.conditions.selector !== '')
    ) {
      return false
    }

    const eventBasedTargetingFlagCheck =
      !doesSurveyActivateByEvent(survey) || hasProgress || activatedSurveys.has(survey.id)
    if (!eventBasedTargetingFlagCheck) return false

    if (
      !survey.linked_flag_key &&
      !survey.targeting_flag_key &&
      !survey.internal_targeting_flag_key &&
      !survey.feature_flag_keys?.length
    ) {
      // Survey is targeting All Users with no conditions
      return true
    }

    const linkedFlagCheck = isSurveyFlagEnabled(survey.linked_flag_key, flags)

    const linkedFlagVariant = survey.conditions?.linkedFlagVariant
    let linkedFlagVariantCheck = true
    if (linkedFlagVariant) {
      linkedFlagVariantCheck = survey.linked_flag_key
        ? flags[survey.linked_flag_key] === linkedFlagVariant || linkedFlagVariant === ANY_FLAG_VARIANT
        : true
    }

    const targetingFlagCheck = isSurveyFlagEnabled(survey.targeting_flag_key, flags)

    const internalTargetingFlagCheck =
      survey.internal_targeting_flag_key && !canSurveyActivateRepeatedly(survey) && !hasProgress
        ? isSurveyFlagEnabled(survey.internal_targeting_flag_key, flags)
        : true
    const flagsCheck = survey.feature_flag_keys?.length
      ? survey.feature_flag_keys.every(({ key, value }: { key: string; value?: string }) => {
          return !key || !value || isSurveyFlagEnabled(value, flags)
        })
      : true

    return (
      linkedFlagCheck &&
      linkedFlagVariantCheck &&
      targetingFlagCheck &&
      internalTargetingFlagCheck &&
      eventBasedTargetingFlagCheck &&
      flagsCheck
    )
  })
}
