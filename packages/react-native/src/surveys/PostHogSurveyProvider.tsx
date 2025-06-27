import React, { useEffect, useMemo, useState } from 'react'

import { dismissedSurveyEvent, sendSurveyShownEvent } from './components/Surveys'

import { getActiveMatchingSurveys } from './getActiveMatchingSurveys'
import { useSurveyStorage } from './useSurveyStorage'
import { useActivatedSurveys } from './useActivatedSurveys'
import { SurveyModal } from './components/SurveyModal'
import { defaultSurveyAppearance, getContrastingTextColor, SurveyAppearanceTheme } from './surveys-utils'
import { Survey, SurveyAppearance, SurveyType } from '../../../posthog-core/src'
import { usePostHog } from '../hooks/usePostHog'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { PostHog } from '../posthog-rn'

type ActiveSurveyContextType = { survey: Survey; onShow: () => void; onClose: (submitted: boolean) => void } | undefined
const ActiveSurveyContext = React.createContext<ActiveSurveyContextType>(undefined)
// export const useActiveSurvey = (): ActiveSurveyContextType => React.useContext(ActiveSurveyContext)

// type FeedbackSurveyHook = {
//   survey: Survey
//   showSurveyModal: () => void
//   hideSurveyModal: () => void
// }
const FeedbackSurveyContext = React.createContext<
  | {
      surveys: Survey[]
      activeSurvey: Survey | undefined
      setActiveSurvey: React.Dispatch<React.SetStateAction<Survey | undefined>>
    }
  | undefined
>(undefined)
// export const useFeedbackSurvey = (selector: string): FeedbackSurveyHook | undefined => {
//   const context = React.useContext(FeedbackSurveyContext)
//   const survey = context?.surveys.find(
//     (survey: Survey) => survey.type === SurveyType.Widget && survey.appearance?.widgetSelector === selector
//   )
//   if (!context || !survey) {
//     return undefined
//   }

//   return {
//     survey,
//     showSurveyModal: () => context.setActiveSurvey(survey),
//     hideSurveyModal: () => {
//       if (context.activeSurvey === survey) {
//         context.setActiveSurvey(undefined)
//       }
//     },
//   }
// }

export type PostHogSurveyProviderProps = {
  // /**
  //  * Whether to show the default survey modal when there is an active survey. (Default true)
  //  * If false, you can call useActiveSurvey and render survey content yourself.
  //  **/
  // automaticSurveyModal?: boolean

  /**
   * The default appearance for surveys when not specified in PostHog.
   */
  defaultSurveyAppearance?: SurveyAppearance

  /**
   * If true, PosHog appearance will be ignored and defaultSurveyAppearance is always used.
   */
  overrideAppearanceWithDefault?: boolean

  client?: PostHog

  children: React.ReactNode
}

export function PostHogSurveyProvider(props: PostHogSurveyProviderProps): JSX.Element {
  const posthogFromHook = usePostHog()
  const posthog = props.client ?? posthogFromHook
  const { seenSurveys, setSeenSurvey, setLastSeenSurveyDate } = useSurveyStorage()
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [activeSurvey, setActiveSurvey] = useState<Survey | undefined>(undefined)
  const activatedSurveys = useActivatedSurveys(posthog, surveys)

  const flags = useFeatureFlags(posthog)

  // Load surveys once
  useEffect(() => {
    // TODO: for the first time, sometimes the surveys are not fetched from storage, so we need to fetch them from the API
    // because the remote config is still being fetched from the API
    posthog
      .ready()
      .then(() => posthog.getSurveys())
      .then(setSurveys)
      .catch(() => {})
  }, [posthog])

  // Whenever state changes and there's no active survey, check if there is a new survey to show
  useEffect(() => {
    if (activeSurvey) {
      return
    }

    const activeSurveys = getActiveMatchingSurveys(
      surveys,
      flags ?? {},
      seenSurveys,
      activatedSurveys
      // lastSeenSurveyDate
    )

    const popoverSurveys = activeSurveys.filter((survey: Survey) => survey.type === SurveyType.Popover)
    // TODO: sort by appearance delay, implement delay
    // const popoverSurveyQueue = sortSurveysByAppearanceDelay(popoverSurveys)

    if (popoverSurveys.length > 0) {
      setActiveSurvey(popoverSurveys[0])
    }
  }, [activeSurvey, flags, surveys, seenSurveys, activatedSurveys])

  // Merge survey appearance so that components and hooks can use a consistent model
  const surveyAppearance = useMemo<SurveyAppearanceTheme>(() => {
    if (props.overrideAppearanceWithDefault || !activeSurvey) {
      return {
        ...defaultSurveyAppearance,
        ...(props.defaultSurveyAppearance ?? {}),
      }
    }
    return {
      ...defaultSurveyAppearance,
      ...(props.defaultSurveyAppearance ?? {}),
      ...(activeSurvey.appearance ?? {}),
      // If submitButtonColor is set by PostHog, ensure submitButtonTextColor is also set to contrast
      ...(activeSurvey.appearance?.submitButtonColor
        ? {
            submitButtonTextColor:
              activeSurvey.appearance.submitButtonTextColor ??
              getContrastingTextColor(activeSurvey.appearance.submitButtonColor),
          }
        : {}),
    }
  }, [activeSurvey, props.defaultSurveyAppearance, props.overrideAppearanceWithDefault])

  const activeContext = useMemo(() => {
    if (!activeSurvey) {
      return undefined
    }
    return {
      survey: activeSurvey,
      onShow: () => {
        sendSurveyShownEvent(activeSurvey, posthog)
        setLastSeenSurveyDate(new Date())
      },
      onClose: (submitted: boolean) => {
        setSeenSurvey(activeSurvey.id)
        setActiveSurvey(undefined)
        if (!submitted) {
          dismissedSurveyEvent(activeSurvey, posthog)
        }
      },
    }
  }, [activeSurvey, posthog, setLastSeenSurveyDate, setSeenSurvey])

  // Modal is shown for PopOver surveys or if automaticSurveyModal is true, and for all widget surveys
  // because these would have been invoked by the useFeedbackSurvey hook's showSurveyModal() method
  const shouldShowModal = activeContext && activeContext.survey.type === SurveyType.Popover

  return (
    <ActiveSurveyContext.Provider value={activeContext}>
      <FeedbackSurveyContext.Provider value={{ surveys, activeSurvey, setActiveSurvey }}>
        {props.children}
        {shouldShowModal && <SurveyModal appearance={surveyAppearance} {...activeContext} />}
      </FeedbackSurveyContext.Provider>
    </ActiveSurveyContext.Provider>
  )
}

// function sortSurveysByAppearanceDelay(surveys: Survey[]): Survey[] {
//   return surveys.sort(
//     (a, b) => (a.appearance?.surveyPopupDelaySeconds ?? 0) - (b.appearance?.surveyPopupDelaySeconds ?? 0)
//   )
// }
