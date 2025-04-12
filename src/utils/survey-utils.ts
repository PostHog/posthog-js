import { Survey, SurveyMatchType } from '../posthog-surveys-types'
import { userAgent, window } from '../utils/globals'
import { createLogger } from '../utils/logger'
import { isMatchingRegex } from '../utils/regex-utils'
import { detectDeviceType } from './user-agent-utils'

export const SURVEY_LOGGER = createLogger('[Surveys]')

const surveyValidationMap: Record<SurveyMatchType, (targets: string[], value: string) => boolean> = {
    icontains: (targets, value) => targets.some((target) => value.toLowerCase().includes(target.toLowerCase())),
    not_icontains: (targets, value) => targets.every((target) => !value.toLowerCase().includes(target.toLowerCase())),
    regex: (targets, value) => targets.some((target) => isMatchingRegex(value, target)),
    not_regex: (targets, value) => targets.every((target) => !isMatchingRegex(value, target)),
    exact: (targets, value) => targets.some((target) => value === target),
    is_not: (targets, value) => targets.every((target) => value !== target),
}

function defaultMatchType(matchType?: SurveyMatchType): SurveyMatchType {
    return matchType ?? 'icontains'
}

// use urlMatchType to validate url condition, fallback to contains for backwards compatibility
export function doesSurveyUrlMatch(survey: Pick<Survey, 'conditions'>): boolean {
    if (!survey.conditions?.url) {
        return true
    }
    // if we dont know the url, assume it is not a match
    const href = window?.location?.href
    if (!href) {
        return false
    }
    const targets = [survey.conditions.url]
    return surveyValidationMap[defaultMatchType(survey.conditions?.urlMatchType)](targets, href)
}

export function doesSurveyDeviceTypesMatch(survey: Survey): boolean {
    if (!survey.conditions?.deviceTypes || survey.conditions?.deviceTypes.length === 0) {
        return true
    }
    // if we dont know the device type, assume it is not a match
    if (!userAgent) {
        return false
    }

    const deviceType = detectDeviceType(userAgent)
    return surveyValidationMap[defaultMatchType(survey.conditions?.deviceTypesMatchType)](
        survey.conditions.deviceTypes,
        deviceType
    )
}
