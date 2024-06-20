import { useState, useEffect } from 'preact/hooks'
import { Survey } from '../../..//posthog-surveys-types'
import { PostHog } from '../../../posthog-core'
import { window as _window } from '../../../utils/globals'

const window = _window as Window & typeof globalThis

export function usePopupVisibility(
    survey: Survey,
    posthog: PostHog | undefined,
    millisecondDelay: number,
    isPreviewMode: boolean,
    removeSurveyFromFocus: (id: string) => void
) {
    const [isPopupVisible, setIsPopupVisible] = useState(isPreviewMode || millisecondDelay === 0)
    const [isSurveySent, setIsSurveySent] = useState(false)

    useEffect(() => {
        if (isPreviewMode || !posthog) {
            return
        }

        const handleSurveyClosed = () => {
            removeSurveyFromFocus(survey.id)
            setIsPopupVisible(false)
        }

        const handleSurveySent = () => {
            if (!survey.appearance?.displayThankYouMessage) {
                removeSurveyFromFocus(survey.id)
                setIsPopupVisible(false)
            } else {
                setIsSurveySent(true)
                if (survey.appearance?.autoDisappear) {
                    setTimeout(() => {
                        removeSurveyFromFocus(survey.id)
                        setIsPopupVisible(false)
                    }, 5000)
                }
            }
        }

        window.addEventListener('PHSurveyClosed', handleSurveyClosed)
        window.addEventListener('PHSurveySent', handleSurveySent)

        if (millisecondDelay > 0) {
            const timeoutId = setTimeout(() => {
                setIsPopupVisible(true)
                window.dispatchEvent(new Event('PHSurveyShown'))
                posthog.capture('survey shown', {
                    $survey_name: survey.name,
                    $survey_id: survey.id,
                    $survey_iteration: survey.current_iteration,
                    $survey_iteration_start_date: survey.current_iteration_start_date,
                    sessionRecordingUrl: posthog.get_session_replay_url?.(),
                })
                localStorage.setItem(`lastSeenSurveyDate`, new Date().toISOString())
            }, millisecondDelay)

            return () => {
                clearTimeout(timeoutId)
                window.removeEventListener('PHSurveyClosed', handleSurveyClosed)
                window.removeEventListener('PHSurveySent', handleSurveySent)
            }
        } else {
            setIsPopupVisible(true)
            window.dispatchEvent(new Event('PHSurveyShown'))
            posthog.capture('survey shown', {
                $survey_name: survey.name,
                $survey_id: survey.id,
                $survey_iteration: survey.current_iteration,
                $survey_iteration_start_date: survey.current_iteration_start_date,
                sessionRecordingUrl: posthog.get_session_replay_url?.(),
            })
            localStorage.setItem(`lastSeenSurveyDate`, new Date().toISOString())

            return () => {
                window.removeEventListener('PHSurveyClosed', handleSurveyClosed)
                window.removeEventListener('PHSurveySent', handleSurveySent)
            }
        }
    }, [])

    return { isPopupVisible, isSurveySent, setIsPopupVisible }
}
