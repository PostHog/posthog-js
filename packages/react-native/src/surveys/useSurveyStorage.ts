import { PostHogPersistedProperty } from '@posthog/core'
import { getSurveyIterationKey, isSurveyKeyForSurvey, SurveyWithIteration } from '@posthog/core/surveys'
import { useCallback, useEffect, useState } from 'react'
import { usePostHog } from '../hooks/usePostHog'
import type { PostHog } from '../posthog-rn'

type SurveyStorage = {
  isReady: boolean
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
  return [surveyKey, ...current.filter((key) => !isSurveyKeyForSurvey(key, survey.id))].slice(0, MAX_SEEN_SURVEYS)
}

export function useSurveyStorage(client?: PostHog): SurveyStorage {
  const fromHook = usePostHog()
  const posthogStorage = client ?? fromHook
  const [isReady, setIsReady] = useState(false)
  const [lastSeenSurveyDate, setLastSeenSurveyDate] = useState<Date | undefined>(undefined)
  const [seenSurveys, setSeenSurveys] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    setIsReady(false)
    const load = () => {
      if (!mounted) return
      const lastSeenSurveyDate = posthogStorage.getPersistedProperty(PostHogPersistedProperty.SurveyLastSeenDate)
      if (typeof lastSeenSurveyDate === 'string') {
        setLastSeenSurveyDate(new Date(lastSeenSurveyDate))
      }

      const serialisedSeenSurveys = posthogStorage.getPersistedProperty(PostHogPersistedProperty.SurveysSeen)
      if (typeof serialisedSeenSurveys === 'string') {
        let parsedSeenSurveys: unknown
        try {
          parsedSeenSurveys = JSON.parse(serialisedSeenSurveys)
        } catch {
          parsedSeenSurveys = []
        }
        if (Array.isArray(parsedSeenSurveys)) {
          setSeenSurveys(parsedSeenSurveys.filter((key): key is string => typeof key === 'string'))
        }
      } else {
        setSeenSurveys([])
      }
      setIsReady(true)
    }
    void posthogStorage.ready().then(load)
    const unsubscribe = posthogStorage.on('surveysReset', () => {
      void posthogStorage.ready().then(load)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [posthogStorage])

  return {
    isReady,
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
