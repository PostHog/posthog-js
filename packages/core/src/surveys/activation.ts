import { SurveySchedule } from '../types'

// Structural type instead of Pick<Survey, 'schedule' | 'conditions'>: the browser SDK
// has its own Survey type using literal unions where core uses enums, so picking from
// core's Survey would reject browser values. The template-literal schedule type accepts
// both while still rejecting arbitrary strings.
type SurveyForRepeatActivation = {
  schedule?: `${SurveySchedule}` | null
  conditions?: {
    events?: {
      repeatedActivation?: boolean
      values?: { name: string }[]
    } | null
  } | null
}

export function doesSurveyActivateByEvent(survey: SurveyForRepeatActivation): boolean {
  return !!survey.conditions?.events?.values?.length
}

/**
 * Platform-independent part of "can this survey show again after being seen":
 * event-repeated activation or an 'always' schedule. SDKs may OR in
 * platform-specific state (e.g. the web SDK's in-progress partial responses).
 */
export function canSurveyActivateRepeatedly(survey: SurveyForRepeatActivation): boolean {
  return (
    (doesSurveyActivateByEvent(survey) && !!survey.conditions?.events?.repeatedActivation) ||
    survey.schedule === SurveySchedule.Always
  )
}
