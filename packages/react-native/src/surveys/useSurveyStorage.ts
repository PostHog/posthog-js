import { PostHogPersistedProperty } from '../../../posthog-core/src'
import { useCallback, useEffect, useState } from 'react'
import { usePostHog } from '../hooks/usePostHog'

type SurveyStorage = {
  seenSurveys: string[]
  setSeenSurvey: (surveyId: string) => void
  lastSeenSurveyDate: Date | undefined
  setLastSeenSurveyDate: (date: Date) => void
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
      (surveyId: string) => {
        setSeenSurveys((current) => {
          // To keep storage bounded, only keep the last 20 seen surveys
          const newValue = [surveyId, ...current.filter((id) => id !== surveyId)]
          posthogStorage.setPersistedProperty(
            PostHogPersistedProperty.SurveysSeen,
            JSON.stringify(newValue.slice(0, 20))
          )
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
