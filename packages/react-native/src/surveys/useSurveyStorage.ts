import { PostHogPersistedProperty } from '@posthog/core'
import { getSurveyIterationKey, SurveyWithIteration } from '@posthog/core/surveys'
import { useCallback, useEffect, useState } from 'react'
import { usePostHog } from '../hooks/usePostHog'

type SurveyStorage = {
  // Iteration-qualified keys (getSurveyIterationKey) so repeating surveys re-show when a new iteration starts
  seenSurveys: string[]
  setSeenSurvey: (survey: SurveyWithIteration) => void
  lastSeenSurveyDate: Date | undefined
  setLastSeenSurveyDate: (date: Date) => void
}

// To keep storage bounded, only keep the last 20 seen surveys
const MAX_SEEN_SURVEYS = 20

// One slot per survey: stale keys from earlier iterations (or the pre-iteration bare id)
// can never match again and would otherwise evict other surveys' seen state.
export function updateSeenSurveys(current: string[], survey: SurveyWithIteration): string[] {
  const surveyKey = getSurveyIterationKey(survey)
  return [surveyKey, ...current.filter((key) => key !== survey.id && !key.startsWith(`${survey.id}_`))].slice(
    0,
    MAX_SEEN_SURVEYS
  )
}

export function useSurveyStorage(): SurveyStorage {
  const posthogStorage = usePostHog()
  const [lastSeenSurveyDate, setLastSeenSurveyDate] = useState<Date | undefined>(undefined)
  const [seenSurveys, setSeenSurveys] = useState<string[]>([])

  useEffect(() => {
    posthogStorage.ready().then(() => {
      const lastSeenSurveyDate = posthogStorage.getPersistedProperty(PostHogPersistedProperty.SurveyLastSeenDate)
      if (typeof lastSeenSurveyDate === 'string') {
        setLastSeenSurveyDate(new Date(lastSeenSurveyDate))
      }

      const serialisedSeenSurveys = posthogStorage.getPersistedProperty(PostHogPersistedProperty.SurveysSeen)
      if (typeof serialisedSeenSurveys === 'string') {
        const parsedSeenSurveys: unknown = JSON.parse(serialisedSeenSurveys)
        if (Array.isArray(parsedSeenSurveys) && typeof parsedSeenSurveys[0] === 'string') {
          setSeenSurveys(parsedSeenSurveys)
        }
      }
    })
  }, [posthogStorage])

  return {
    seenSurveys,
    setSeenSurvey: useCallback(
      (survey: SurveyWithIteration) => {
        setSeenSurveys((current) => {
          const newValue = updateSeenSurveys(current, survey)
          posthogStorage.setPersistedProperty(PostHogPersistedProperty.SurveysSeen, JSON.stringify(newValue))
          return newValue
        })
      },
      [posthogStorage]
    ),
    lastSeenSurveyDate,
    setLastSeenSurveyDate: useCallback(
      (date: Date) => {
        setLastSeenSurveyDate(date)
        posthogStorage.setPersistedProperty(PostHogPersistedProperty.SurveyLastSeenDate, date.toISOString())
      },
      [posthogStorage]
    ),
  }
}
