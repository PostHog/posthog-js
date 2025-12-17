import { canActivateRepeatedly, hasEvents, surveyValidationMap } from './surveys-utils'
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

  return surveyValidationMap[defaultMatchType(survey.conditions.deviceTypesMatchType)](survey.conditions.deviceTypes, [
    currentDeviceType,
  ])
}

function isSurveyFlagEnabled(flagKey: string | undefined, flags: Record<string, FeatureFlagValue>): boolean {
  return flagKey ? !!flags[flagKey] === true : true
}

export function getActiveMatchingSurveys(
  surveys: Survey[],
  flags: Record<string, FeatureFlagValue>,
  seenSurveys: string[],
  activatedSurveys: ReadonlySet<string>
  // lastSeenSurveyDate: Date | undefined
): Survey[] {
  return surveys.filter((survey: Survey) => {
    // Is Active
    if (!survey.start_date || survey.end_date) {
      return false
    }

    // device type check
    if (!doesSurveyDeviceTypesMatch(survey)) {
      return false
    }

    if (seenSurveys.includes(survey.id) && !canActivateRepeatedly(survey)) {
      return false
    }

    // const surveyWaitPeriodInDays = survey.conditions?.seenSurveyWaitPeriodInDays
    // if (surveyWaitPeriodInDays && lastSeenSurveyDate) {
    //   const today = new Date()
    //   const diff = Math.abs(today.getTime() - lastSeenSurveyDate.getTime())
    //   const diffDaysFromToday = Math.ceil(diff / (1000 * 3600 * 24))
    //   if (diffDaysFromToday < surveyWaitPeriodInDays) {
    //     return false
    //   }
    // }

    // Skip surveys with URL or CSS selector conditions (not supported in React Native)
    if (
      (survey.conditions?.url && survey.conditions.url !== '') ||
      (survey.conditions?.selector && survey.conditions.selector !== '')
    ) {
      return false
    }

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

    const eventBasedTargetingFlagCheck = hasEvents(survey) ? activatedSurveys.has(survey.id) : true

    const internalTargetingFlagCheck =
      survey.internal_targeting_flag_key && !canActivateRepeatedly(survey)
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
