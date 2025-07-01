import { canActivateRepeatedly, hasEvents } from './surveys-utils'
import { currentDeviceType } from '../native-deps'
import { FeatureFlagValue, Survey, SurveyMatchType } from '../../../posthog-core/src'

const isMatchingRegex = function (value: string, pattern: string): boolean {
  if (!isValidRegex(pattern)) {
    return false
  }

  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

const isValidRegex = function (str: string): boolean {
  try {
    new RegExp(str)
  } catch {
    return false
  }
  return true
}

const surveyValidationMap: Record<SurveyMatchType, (targets: string[], value: string) => boolean> = {
  icontains: (targets, value) => targets.some((target) => value.toLowerCase().includes(target.toLowerCase())),

  not_icontains: (targets, value) => targets.every((target) => !value.toLowerCase().includes(target.toLowerCase())),

  regex: (targets, value) => targets.some((target) => isMatchingRegex(value, target)),

  not_regex: (targets, value) => targets.every((target) => !isMatchingRegex(value, target)),

  exact: (targets, value) => targets.some((target) => value === target),

  is_not: (targets, value) => targets.every((target) => value !== target),
}

function defaultMatchType(matchType?: SurveyMatchType): SurveyMatchType {
  return matchType ?? SurveyMatchType.Icontains
}

function doesSurveyDeviceTypesMatch(survey: Survey): boolean {
  if (!survey.conditions?.deviceTypes || survey.conditions.deviceTypes.length === 0) {
    return true
  }

  const deviceType = currentDeviceType
  return surveyValidationMap[defaultMatchType(survey.conditions.deviceTypesMatchType)](
    survey.conditions.deviceTypes,
    deviceType
  )
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

    // URL and CSS selector conditions are currently ignored

    if (
      !survey.linked_flag_key &&
      !survey.targeting_flag_key &&
      !survey.internal_targeting_flag_key &&
      !survey.feature_flag_keys?.length
    ) {
      // Survey is targeting All Users with no conditions
      return true
    }

    const linkedFlagCheck = survey.linked_flag_key ? flags[survey.linked_flag_key] === true : true
    const targetingFlagCheck = survey.targeting_flag_key ? flags[survey.targeting_flag_key] === true : true

    const eventBasedTargetingFlagCheck = hasEvents(survey) ? activatedSurveys.has(survey.id) : true

    const internalTargetingFlagCheck =
      survey.internal_targeting_flag_key && !canActivateRepeatedly(survey)
        ? flags[survey.internal_targeting_flag_key] === true
        : true
    const flagsCheck = survey.feature_flag_keys?.length
      ? survey.feature_flag_keys.every(({ key, value }: { key: string; value?: string }) => {
          return !key || !value || flags[value] === true
        })
      : true

    return (
      linkedFlagCheck && targetingFlagCheck && internalTargetingFlagCheck && eventBasedTargetingFlagCheck && flagsCheck
    )
  })
}
