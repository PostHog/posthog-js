import { useState, useCallback, useRef, useMemo, type RefCallback, useEffect } from 'react'
import { usePostHog } from '../../../hooks/usePostHog'
import { DisplaySurveyType, SurveyEventName, SurveyEventProperties, SurveyPosition } from 'posthog-js'

export interface UseThumbSurveyOptions {
    /** ID of the target PostHog survey */
    surveyId: string
    /** Configure the position of the pop-up for followup questions, if applicable. Defaults to SurveyPosition.NextToTrigger */
    displayPosition?: SurveyPosition
    /** Custom event properties to pass with each survey result */
    properties?: Record<string, any>
    /** Callback on thumb button click */
    onResponse?: (response: 'up' | 'down') => void
    /** Disable automatically emitting `survey shown` on hook mount. Defaults to false. */
    disableAutoShownTracking?: boolean
}

export interface UseThumbSurveyResult {
    /** Call this to submit a survey response, with value 'up' or 'down' */
    respond: (value: 'up' | 'down') => void
    /** User's response value, available after submission */
    response: 'up' | 'down' | null
    /** Ref to attach to the trigger element for positioning the followup survey popup */
    triggerRef: RefCallback<HTMLElement>
    /** Method to manually trigger a `survey shown` event. Only available when disableAutoShownTracking is true. */
    trackShown?: () => void
}

const TRIGGER_ATTR = 'data-ph-thumb-survey-trigger'

/**
 * Convenience hook for managing a "thumb" (1-2 rating scale) survey.
 *
 * Pre-requisites:
 * 1) Ensure surveys are not disabled in your PostHog config (`disable_surveys: false`)
 * 2) Ensure surveys are enabled in your PostHog project (Settings > Surveys > Enable surveys)
 *
 * How-to:
 * 1) Create an API survey in PostHog (New survey > Presentation > API)
 * 2) Set the first question to a thumb rating scale (Question type: Rating -> Display type: Emoji -> Scale: 1-2 (thumbs up/down))
 * 3) Set the thumb question to "Automatically submit on selection"
 * 4) Optionally add follow-up questions
 * 5) Use the hook:
 *
 * ```typescript
 * const { respond, response, triggerRef } = useThumbSurvey({
 *  surveyId: 'my-survey-id',
 *  properties: { foo: 'bar' }, // optional custom properties to pass along with the survey responses
 *  onResponse: (response) => { console.log(response) }, // optional callback on submission
 * })
 *
 * return (
 *  <div ref={triggerRef}>
 *      <button onClick={() => respond('up')} style={{ color: response === 'up' ? 'green' : undefined }}>👍</button>
 *      <button onClick={() => respond('down')} style={{ color: response === 'down' ? 'red' : undefined }}>👎</button>
 *  </div>
 * )
 * ```
 *
 * 6) If your survey has further questions, the survey will automatically display as a popover, either:
 *  - [default] next to the triggerRef element,
 *  - OR wherever you specify in options.position
 *
 * Notes:
 * - The thumbs up/down response will ALWAYS be recorded, whether your survey is set to collect partial responses or not.
 * - By default, followup questions will be displayed as a pop-up next to the triggerRef. Use options.position to change the position.
 * - By default, `survey shown` is emitted automatically on hook mount. To prevent this behavior, set `disableAutoShownTracking: true`,
 *   and manually call `trackShown()` when you want to emit this event.
 *
 * @param options UseThumbSurveyOptions
 * @returns UseThumbSurveyResult
 */
export function useThumbSurvey({
    surveyId,
    displayPosition = SurveyPosition.NextToTrigger,
    properties,
    onResponse,
    disableAutoShownTracking,
}: UseThumbSurveyOptions): UseThumbSurveyResult {
    const posthog = usePostHog()
    const [responded, setResponded] = useState<'up' | 'down' | null>(null)
    const [instanceId] = useState(() => Math.random().toString(36).slice(2, 9))
    const triggerValue = useMemo(() => `${surveyId}-${instanceId}`, [surveyId, instanceId])

    const elementRef = useRef<HTMLElement | null>(null)
    const triggerRef = useCallback(
        (el: HTMLElement | null) => {
            if (elementRef.current) {
                elementRef.current.removeAttribute(TRIGGER_ATTR)
            }
            elementRef.current = el
            if (el) {
                el.setAttribute(TRIGGER_ATTR, triggerValue)
            }
        },
        [triggerValue]
    )

    const shownRef = useRef(false)
    const respondedRef = useRef(false)

    const trackShown = useCallback(() => {
        if (shownRef.current || !posthog) return
        shownRef.current = true
        posthog.capture(SurveyEventName.SHOWN, {
            [SurveyEventProperties.SURVEY_ID]: surveyId,
            sessionRecordingUrl: posthog.get_session_replay_url?.(),
            ...properties,
        })
    }, [posthog, surveyId, properties])

    useEffect(() => {
        if (!disableAutoShownTracking) {
            trackShown()
        }
    }, [trackShown, disableAutoShownTracking])

    const respond = useCallback(
        (value: 'up' | 'down') => {
            if (!posthog?.surveys || respondedRef.current) return
            respondedRef.current = true

            setResponded(value)
            onResponse?.(value)

            posthog.surveys.displaySurvey(surveyId, {
                displayType: DisplaySurveyType.Popover,
                ignoreConditions: true,
                ignoreDelay: true,
                properties,
                initialResponses: { 0: value === 'up' ? 1 : 2 },
                position: displayPosition,
                selector: `[${TRIGGER_ATTR}="${triggerValue}"]`,
                skipShownEvent: true,
            })
        },
        [posthog, surveyId, displayPosition, properties, onResponse, triggerValue]
    )

    return {
        respond,
        response: responded,
        triggerRef,
        ...(disableAutoShownTracking && { trackShown }),
    }
}
