import { useEffect, useMemo, useState } from 'react'

import type { ActionStepType, PropertyFilters, PropertyOperator, Survey } from '@posthog/core'
import { matchPropertyFilters } from '@posthog/core/surveys'
import type { PostHog } from '../posthog-rn'

const SURVEY_SHOWN_EVENT_NAME = 'survey shown'

interface EventSurveyConfig {
  surveyId: string
  propertyFilters?: PropertyFilters
}

type SurveyActionStep = ActionStepType & {
  properties?: {
    key: string
    value?: string | number | boolean | (string | number | boolean)[] | null
    operator?: PropertyOperator
  }[]
}

function actionPropertyFilters(step: SurveyActionStep): PropertyFilters | undefined {
  return step.properties?.length
    ? Object.fromEntries(
        step.properties.map(({ key, value, operator = 'exact' }) => [
          key,
          { values: Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)], operator },
        ])
      )
    : undefined
}

export function useActivatedSurveys(posthog: PostHog, surveys: Survey[]): ReadonlySet<string> {
  const [activatedSurveys, setActivatedSurveys] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    setActivatedSurveys(new Set())
    return posthog.on('surveysReset', () => setActivatedSurveys(new Set()))
  }, [posthog])

  const eventMap = useMemo(() => {
    const newEventMap = new Map<string, EventSurveyConfig[]>()

    const register = (eventName: string, config: EventSurveyConfig): void => {
      const configs = newEventMap.get(eventName) ?? []
      configs.push(config)
      newEventMap.set(eventName, configs)
    }

    for (const survey of surveys) {
      for (const event of survey.conditions?.events?.values ?? []) {
        register(event.name, {
          surveyId: survey.id,
          propertyFilters: event.propertyFilters,
        })
      }
      for (const action of survey.conditions?.actions?.values ?? []) {
        for (const step of action.steps ?? []) {
          // Native events cannot satisfy an action step that depends on a DOM element or page URL.
          if (step?.event && !step.selector && !step.text && !step.href && !step.url) {
            register(step.event, { surveyId: survey.id, propertyFilters: actionPropertyFilters(step) })
          }
        }
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
