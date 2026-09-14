import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { dismissedSurveyEvent, sendSurveyShownEvent } from './components/Surveys'

import { getActiveMatchingSurveys } from './getActiveMatchingSurveys'
import { useSurveyStorage } from './useSurveyStorage'
import { canCaptureSurvey, createSurveyProgress, SurveyProgress, SurveyProgressStore } from './survey-progress'
import { getSurveyIterationKey } from '@posthog/core/surveys'
import { useActivatedSurveys } from './useActivatedSurveys'
import { SurveyModal } from './components/SurveyModal'
import { defaultSurveyAppearance, getContrastingTextColor, SurveyAppearanceTheme } from './surveys-utils'
import { Survey, SurveyAppearance, SurveyType, type SurveyResponses } from '@posthog/core'
import { usePostHog } from '../hooks/usePostHog'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { PostHog } from '../posthog-rn'
import { applySurveyTranslationForUser, detectUserLanguage } from './survey-translations'

type ActiveSurveyContextType =
  | {
      survey: Survey
      surveyLanguage: string | null
      onShow: () => void
      onClose: (submitted: boolean, responses: SurveyResponses) => void
    }
  | undefined
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
  /**
   * Whether eligible popover surveys are automatically presented. (Default: true)
   * Set to false to defer presentation — e.g. while a native-stack formSheet/modal is on top.
   * Deferral is display-only: the survey stays armed and presents once this is true again.
   * A survey already on screen is not interrupted when this becomes false.
   *
   * You own flipping this back to true (e.g. wire it to route/screen focus). While it stays
   * false the survey remains deferred and never shows — if the un-defer never happens
   * (sheet dismissed without re-focusing the provider, an unmount, an error boundary), the
   * survey stays armed indefinitely and no "survey shown" event fires.
   */
  autoPresentSurveys?: boolean

  /**
   * The default appearance for surveys when not specified in PostHog.
   */
  defaultSurveyAppearance?: SurveyAppearance

  /**
   * If true, PosHog appearance will be ignored and defaultSurveyAppearance is always used.
   */
  overrideAppearanceWithDefault?: boolean

  /**
   * The keyboard avoiding behavior for the survey modal (KeyboardAvoidingView), applied only to Android devices.
   * - 'padding': Adds padding to avoid keyboard (recommended)
   * - 'height': Resizes the view height (default, for legacy - may cause flickering on some Android devices)
   * @default 'height'
   */
  androidKeyboardBehavior?: 'padding' | 'height'

  client?: PostHog

  children: React.ReactNode
}

export function PostHogSurveyProvider(props: PostHogSurveyProviderProps): JSX.Element {
  const posthogFromHook = usePostHog()
  const posthog = props.client ?? posthogFromHook
  const { seenSurveys, setSeenSurvey, setLastSeenSurveyDate, isReady } = useSurveyStorage(posthog)
  const progressStore = useMemo(() => new SurveyProgressStore(posthog), [posthog])
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [activeSurvey, setActiveSurvey] = useState<Survey | undefined>(undefined)
  // Latches the id of the survey once its modal has actually painted, so deferring presentation
  // (autoPresentSurveys=false) never tears down a survey the user is already interacting with.
  const shownSurveyIdRef = useRef<string | undefined>(undefined)
  const sessionEpochRef = useRef(0)
  const activeSessionRef = useRef<object | undefined>(undefined)
  const activatedSurveys = useActivatedSurveys(posthog, surveys)
  const invalidateSession = useCallback(() => {
    sessionEpochRef.current++
    activeSessionRef.current = undefined
    shownSurveyIdRef.current = undefined
  }, [])

  const flags = useFeatureFlags(posthog)
  const [userLanguage, setUserLanguage] = useState(() => detectUserLanguage(posthog))

  useEffect(() => {
    const updateLanguage = () => setUserLanguage(detectUserLanguage(posthog))
    const unsubscribe = posthog.on('personProperties', updateLanguage)
    updateLanguage()
    return unsubscribe
  }, [posthog])

  useEffect(
    () =>
      posthog.on('surveysReset', () => {
        invalidateSession()
        setActiveSurvey(undefined)
      }),
    [posthog, invalidateSession]
  )

  // Load surveys once
  useEffect(() => {
    let mounted = true
    setActiveSurvey(undefined)
    setSurveys([])
    activeSessionRef.current = undefined
    shownSurveyIdRef.current = undefined
    posthog
      .ready()
      .then(() => posthog._onSurveysReady())
      .then(() => {
        setUserLanguage(detectUserLanguage(posthog))
        return posthog.getSurveys()
      })
      .then((loadedSurveys) => {
        if (!mounted) return
        progressStore.reconcile(loadedSurveys)
        setSurveys(loadedSurveys)
      })
      .catch(() => {})
    return () => {
      mounted = false
      invalidateSession()
    }
  }, [posthog, progressStore, invalidateSession])

  // Whenever state changes, re-select the popover survey to show. A survey that has already
  // painted is left alone; an armed-but-deferred one is re-validated so it can't be presented
  // after it stops matching (e.g. its targeting flag flips off during a long deferral).
  useEffect(() => {
    if (!isReady || !canCaptureSurvey(posthog)) return
    const isShown = !!activeSurvey && shownSurveyIdRef.current === activeSurvey.id
    if (isShown) {
      return
    }

    const activeSurveys = getActiveMatchingSurveys(
      surveys,
      flags ?? {},
      seenSurveys,
      activatedSurveys,
      new Set(surveys.filter((survey) => progressStore.load(survey)).map(getSurveyIterationKey))
      // lastSeenSurveyDate
    )

    const popoverSurveys = activeSurveys
      .filter((survey: Survey) => survey.type === SurveyType.Popover)
      .sort((a, b) => Number(!!progressStore.load(b)) - Number(!!progressStore.load(a)))
    // TODO: sort by appearance delay, implement delay
    // const popoverSurveyQueue = sortSurveysByAppearanceDelay(popoverSurveys)

    if (activeSurvey && popoverSurveys.some((survey) => survey.id === activeSurvey.id)) {
      return
    }

    setActiveSurvey(popoverSurveys.length > 0 ? popoverSurveys[0] : undefined)
  }, [activeSurvey, flags, surveys, seenSurveys, activatedSurveys, isReady, posthog, progressStore])

  const translatedActiveSurvey = useMemo(() => {
    return activeSurvey ? applySurveyTranslationForUser(activeSurvey, posthog, userLanguage) : undefined
  }, [activeSurvey, posthog, userLanguage])

  // Merge survey appearance so that components and hooks can use a consistent model
  const surveyAppearance = useMemo<SurveyAppearanceTheme>(() => {
    if (props.overrideAppearanceWithDefault || !translatedActiveSurvey) {
      return {
        ...defaultSurveyAppearance,
        ...(props.defaultSurveyAppearance ?? {}),
      }
    }
    return {
      ...defaultSurveyAppearance,
      ...(props.defaultSurveyAppearance ?? {}),
      ...(translatedActiveSurvey.survey.appearance ?? {}),
      // If submitButtonColor is set by PostHog, ensure submitButtonTextColor is also set to contrast
      ...(translatedActiveSurvey.survey.appearance?.submitButtonColor
        ? {
            submitButtonTextColor:
              translatedActiveSurvey.survey.appearance.submitButtonTextColor ??
              getContrastingTextColor(translatedActiveSurvey.survey.appearance.submitButtonColor),
          }
        : {}),
    }
  }, [translatedActiveSurvey, props.defaultSurveyAppearance, props.overrideAppearanceWithDefault])

  const activeSession = useMemo(
    () =>
      activeSurvey
        ? {
            progress: progressStore.load(activeSurvey) ?? createSurveyProgress(activeSurvey),
            completed: false,
            epoch: sessionEpochRef.current,
          }
        : undefined,
    [activeSurvey, progressStore]
  )

  const activeContext = useMemo(() => {
    if (!activeSurvey || !translatedActiveSurvey || !activeSession) {
      return undefined
    }
    return {
      client: posthog,
      initialProgress: activeSession.progress,
      onProgressChange: (progress: SurveyProgress, completed: boolean) => {
        if (
          activeSessionRef.current !== activeSession ||
          !canCaptureSurvey(posthog) ||
          progressStore.load(activeSurvey)?.submissionId !== activeSession.progress.submissionId
        )
          return false
        activeSession.progress = progress
        activeSession.completed = completed
        if (completed) {
          progressStore.remove(activeSurvey)
          setSeenSurvey(activeSurvey)
        } else {
          progressStore.save(activeSurvey, progress)
        }
        return true
      },
      survey: translatedActiveSurvey.survey,
      surveyLanguage: translatedActiveSurvey.language,
      onShow: () => {
        // Updating translated copy changes this callback, but does not show a new survey.
        if (activeSession.epoch !== sessionEpochRef.current || !canCaptureSurvey(posthog)) return
        if (shownSurveyIdRef.current === activeSurvey.id) {
          return
        }
        activeSessionRef.current = activeSession
        progressStore.save(activeSurvey, activeSession.progress)
        shownSurveyIdRef.current = activeSurvey.id
        sendSurveyShownEvent(translatedActiveSurvey.survey, posthog, translatedActiveSurvey.language)
        setLastSeenSurveyDate(new Date())
      },
      onClose: (submitted: boolean, responses: SurveyResponses) => {
        if (activeSessionRef.current !== activeSession) return
        activeSessionRef.current = undefined
        progressStore.remove(activeSurvey)
        shownSurveyIdRef.current = undefined
        setSeenSurvey(activeSurvey)
        setActiveSurvey(undefined)
        if (submitted || activeSession.completed) return
        if (canCaptureSurvey(posthog)) {
          dismissedSurveyEvent(
            translatedActiveSurvey.survey,
            responses,
            posthog,
            Object.keys(activeSession.progress.responses).length > 0
              ? activeSession.progress.surveyLanguage
              : translatedActiveSurvey.language,
            activeSession.progress
          )
        }
      },
    }
  }, [
    activeSurvey,
    activeSession,
    posthog,
    progressStore,
    setLastSeenSurveyDate,
    setSeenSurvey,
    translatedActiveSurvey,
  ])

  // Present a popover survey when autoPresentSurveys is on. Once it has painted (shownSurveyIdRef),
  // keep it mounted regardless of the gate so a mid-interaction survey is never yanked — the gate
  // defers not-yet-shown surveys, it does not interrupt a live one.
  const autoPresent = props.autoPresentSurveys !== false
  const isAlreadyShown = !!activeSurvey && shownSurveyIdRef.current === activeSurvey.id
  const shouldShowModal =
    activeContext && activeContext.survey.type === SurveyType.Popover && (autoPresent || isAlreadyShown)

  return (
    <ActiveSurveyContext.Provider value={activeContext}>
      <FeedbackSurveyContext.Provider value={{ surveys, activeSurvey, setActiveSurvey }}>
        {props.children}
        {shouldShowModal && (
          <SurveyModal
            key={activeSession?.progress.submissionId}
            appearance={surveyAppearance}
            androidKeyboardBehavior={props.androidKeyboardBehavior}
            {...activeContext}
          />
        )}
      </FeedbackSurveyContext.Provider>
    </ActiveSurveyContext.Provider>
  )
}

// function sortSurveysByAppearanceDelay(surveys: Survey[]): Survey[] {
//   return surveys.sort(
//     (a, b) => (a.appearance?.surveyPopupDelaySeconds ?? 0) - (b.appearance?.surveyPopupDelaySeconds ?? 0)
//   )
// }
