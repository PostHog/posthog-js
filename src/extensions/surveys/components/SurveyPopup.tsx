import { h, FunctionalComponent } from 'preact'
import { PostHog } from '../../../posthog-core'
import { Survey } from '../../../posthog-surveys-types'
import SurveyContext from '../contexts/SurveyContext'
import { ConfirmationMessage } from './ConfirmationMessage'
import { defaultSurveyAppearance, dismissedSurveyEvent } from '../surveys-utils'
import Questions from './Questions'
import { isNumber } from '../../../utils/type-utils'

interface SurveyPopupProps {
    survey: Survey
    posthog?: PostHog
    forceDisableHtml?: boolean
    style?: React.CSSProperties
    previewPageIndex?: number
    onClose: () => void
    isPopupVisible: boolean
    isSurveySent: boolean
    isPreviewMode: boolean
    handleCloseSurveyPopup: () => void
}

export const SurveyPopup: FunctionalComponent<SurveyPopupProps> = ({
    survey,
    forceDisableHtml,
    posthog,
    onClose,
    style,
    previewPageIndex,
    isPopupVisible,
    isSurveySent,
    isPreviewMode,
}) => {
    const shouldShowConfirmation = isSurveySent || previewPageIndex === survey.questions.length
    const confirmationBoxLeftStyle = style?.left && isNumber(style?.left) ? { left: style.left - 40 } : {}

    console.log(JSON.stringify(onClose))

    if (isPreviewMode) {
        style = style || {}
        style.left = 'unset'
        style.right = 'unset'
        style.transform = 'unset'
    }

    return isPopupVisible
        ? h(
              SurveyContext.Provider,
              {
                  value: {
                      activeSurveyId: survey.id,
                      setActiveSurveyId: () => {},
                      isPreviewMode,
                      previewPageIndex,
                      handleCloseSurveyPopup: () => {
                          // setActiveSurveyId(null)
                          return dismissedSurveyEvent(survey, posthog, isPreviewMode)
                      },
                  },
              },
              !shouldShowConfirmation
                  ? h(Questions, {
                        survey,
                        forceDisableHtml: !!forceDisableHtml,
                        posthog,
                        styleOverrides: style,
                    })
                  : h(ConfirmationMessage, {
                        header: survey.appearance?.thankYouMessageHeader || 'Thank you!',
                        description: survey.appearance?.thankYouMessageDescription || '',
                        forceDisableHtml: !!forceDisableHtml,
                        contentType: survey.appearance?.thankYouMessageDescriptionContentType,
                        appearance: survey.appearance || defaultSurveyAppearance,
                        styleOverrides: { ...style, ...confirmationBoxLeftStyle },
                        onClose,
                    })
          )
        : null
}
