import { useEffect, useMemo, useState } from 'react'

import { hasEvents, matchPropertyFilters, PropertyFilters, SurveyEventWithFilters } from './surveys-utils'
import { Survey } from '@posthog/core'
import { PostHog } from '../posthog-rn'

const SURVEY_SHOWN_EVENT_NAME = 'survey shown'

interface EventSurveyConfig {
  surveyId: string
  propertyFilters?: PropertyFilters
}

export function useActivatedSurveys(posthog: PostHog, surveys: Survey[]): ReadonlySet<string> {
  const [activatedSurveys, setActivatedSurveys] = useState<ReadonlySet<string>>(new Set())

  const eventMap = useMemo(() => {
    const newEventMap = new Map<string, EventSurveyConfig[]>()
    for (const survey of surveys.filter(hasEvents)) {
      for (const event of (survey.conditions?.events?.values ?? []) as SurveyEventWithFilters[]) {
        const configs = newEventMap.get(event.name) ?? []
        configs.push({
          surveyId: survey.id,
          propertyFilters: event.propertyFilters,
        })
        newEventMap.set(event.name, configs)
      }
    }
    return newEventMap
  }, [surveys])

  useEffect(() => {
    if (eventMap.size > 0) {
      return posthog.on('capture', (payload: { event: string; properties?: Record<string, unknown> }) => {
        if (eventMap.has(payload.event)) {
          const configs = eventMap.get(payload.event) ?? []
          const matchingSurveyIds = configs
            .filter((config) => matchPropertyFilters(config.propertyFilters, payload.properties))
            .map((config) => config.surveyId)

          if (matchingSurveyIds.length > 0) {
            setActivatedSurveys((current) => new Set([...current, ...matchingSurveyIds]))
          }
        } else if (payload.event === SURVEY_SHOWN_EVENT_NAME) {
          const surveyId = payload.properties?.$survey_id as string | undefined
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
