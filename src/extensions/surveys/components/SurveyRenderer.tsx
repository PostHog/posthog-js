import { FunctionComponent, h } from 'preact'
import { useEffect, useContext } from 'preact/hooks'
import SurveyContext from '../contexts/SurveyContext'
import { SurveyPopup } from './SurveyPopup'
import { Survey } from '../../../posthog-surveys-types'
import { FeedbackWidget } from './FeedbackWidget'
import { PostHog } from '../../../posthog-core'
import { usePopupVisibility } from '../hooks/usePopupVisibility'

interface SurveyRendererProps {
    survey: Survey
    posthog?: PostHog
    delay?: number
    forceDisableHtml?: boolean
    style?: React.CSSProperties
    previewPageIndex?: number | undefined
    readOnly?: boolean
}

export const SurveyRenderer: FunctionComponent<SurveyRendererProps> = ({
    survey,
    posthog,
    style,
    forceDisableHtml = false,
    previewPageIndex,
}) => {
    const { activeSurveyId, setActiveSurveyId, isPreviewMode, handleCloseSurveyPopup } = useContext(SurveyContext)
    const delay = survey.appearance?.surveyPopupDelay ? survey.appearance.surveyPopupDelay * 1000 : 0
    const { isPopupVisible, isSurveySent, setIsPopupVisible } = usePopupVisibility(
        survey,
        posthog,
        delay,
        isPreviewMode
    )

    // TODO: I'm not sure this is the best way to set up the active survey ID, I think this is going to be a bug when I actually
    // run into it.  I think this the right _place_ to handle this logic, but this won't work out of the box.
    useEffect(() => {
        if (!activeSurveyId) {
            setActiveSurveyId(survey.id)
        }
    }, [isPopupVisible, activeSurveyId])

    const handleClose = () => {
        setIsPopupVisible(false)
        setActiveSurveyId(null)
    }

    console.log('SurveyRenderer', { delay, isPopupVisible, isSurveySent, isPreviewMode, previewPageIndex })

    return h(SurveyPopup, {
        survey,
        posthog,
        forceDisableHtml,
        onClose: handleClose,
        style,
        isPopupVisible,
        isSurveySent,
        isPreviewMode,
        previewPageIndex,
        handleCloseSurveyPopup,
    })
}

export const WidgetRenderer: FunctionComponent<SurveyRendererProps> = ({
    survey,
    posthog,
    forceDisableHtml = false,
    readOnly,
}) => {
    return h(FeedbackWidget, { survey, posthog, forceDisableHtml, readOnly, SurveyComponent: SurveyPopup })
}
