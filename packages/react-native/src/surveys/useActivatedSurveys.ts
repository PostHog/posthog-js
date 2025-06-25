import { useEffect, useMemo, useState } from 'react'

import { hasEvents } from './surveys-utils'
import { Survey } from '../../../posthog-core/src'
import { PostHog } from '../posthog-rn'

const SURVEY_SHOWN_EVENT_NAME = 'survey shown'

export function useActivatedSurveys(posthog: PostHog, surveys: Survey[]): ReadonlySet<string> {
  const [activatedSurveys, setActivatedSurveys] = useState<ReadonlySet<string>>(new Set())

  const eventMap = useMemo(() => {
    const newEventMap = new Map<string, string[]>()
    for (const survey of surveys.filter(hasEvents)) {
      for (const event of survey.conditions?.events?.values ?? []) {
        const knownSurveys = newEventMap.get(event.name) ?? []
        knownSurveys.push(survey.id)
        newEventMap.set(event.name, knownSurveys)
      }
    }
    return newEventMap
  }, [surveys])

  useEffect(() => {
    if (eventMap.size > 0) {
      return posthog.on('capture', (payload: { event: string; properties?: { $survey_id?: string } }) => {
        if (eventMap.has(payload.event)) {
          setActivatedSurveys((current) => new Set([...current, ...(eventMap.get(payload.event) ?? [])]))
        } else if (payload.event === SURVEY_SHOWN_EVENT_NAME) {
          // remove survey that from activatedSurveys here.
          const surveyId = payload.properties?.$survey_id
          if (surveyId) {
            setActivatedSurveys((current) => {
              if (!current.has(surveyId)) {
                return current
              }
              const next = new Set(current)
              next.delete(surveyId)
              return next
            })
          }
        }
      })
    }
  }, [eventMap, posthog])

  return activatedSurveys
}
