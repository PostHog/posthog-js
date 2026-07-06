import { Survey } from '../types'

export type SurveyWithIteration = Pick<Survey, 'id' | 'current_iteration'>

/**
 * Iteration-qualified survey identifier ('id' or 'id_iteration'), used to key
 * per-survey display state (seen, in-progress, ...). Keying by iteration lets a
 * repeating survey become visible again when a new iteration starts.
 */
export function getSurveyIterationKey(survey: SurveyWithIteration): string {
  if (survey.current_iteration && survey.current_iteration > 0) {
    return `${survey.id}_${survey.current_iteration}`
  }
  return survey.id
}
