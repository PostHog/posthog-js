import { SurveySchedule } from '../types'

type SurveyWithIteration = {
  id: string
  current_iteration?: number | null
}

type SurveyForRepeatActivation = {
  schedule?: string | null
  conditions?: {
    events?: {
      repeatedActivation?: boolean
      values?: { name: string }[]
    } | null
  } | null
}

/**
 * Storage key for per-survey display state (seen, in-progress, abandoned, ...).
 * Keyed by iteration so repeating surveys become visible again when a new iteration starts.
 */
export function getSurveyStorageKey(prefix: string, survey: SurveyWithIteration): string {
  if (survey.current_iteration && survey.current_iteration > 0) {
    return `${prefix}${survey.id}_${survey.current_iteration}`
  }
  return `${prefix}${survey.id}`
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
