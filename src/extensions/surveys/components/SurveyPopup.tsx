import { h } from 'preact'
import { PostHog } from '../../../posthog-core'
import { Survey } from '../../../posthog-surveys-types'
import { isNumber } from '../../../utils/type-utils'
import { usePopupVisibility } from '../hooks/usePopupVisibility'
import { ConfirmationMessage } from './ConfirmationMessage'
import { SurveyContext, defaultSurveyAppearance, dismissedSurveyEvent } from '../surveys-utils'
import { Questions } from './Questions'

export function SurveyPopup({
    survey,
    forceDisableHtml,
    posthog,
    style,
    previewPageIndex,
    removeSurveyFromFocus,
}: {
    survey: Survey
    forceDisableHtml?: boolean
    posthog?: PostHog
    style?: React.CSSProperties
    previewPageIndex?: number | undefined
    removeSurveyFromFocus: (id: string) => void
}) {
    const isPreviewMode = Number.isInteger(previewPageIndex)
    // NB: The client-side code passes the millisecondDelay in seconds, but setTimeout expects milliseconds, so we multiply by 1000
    const surveyPopupDelayMilliseconds = survey.appearance?.surveyPopupDelaySeconds
        ? survey.appearance.surveyPopupDelaySeconds * 1000
        : 0
    const { isPopupVisible, isSurveySent, setIsPopupVisible } = usePopupVisibility(
        survey,
        posthog,
        surveyPopupDelayMilliseconds,
        isPreviewMode,
        removeSurveyFromFocus
    )
    const shouldShowConfirmation = isSurveySent || previewPageIndex === survey.questions.length
    const confirmationBoxLeftStyle = style?.left && isNumber(style?.left) ? { left: style.left - 40 } : {}

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
                      isPreviewMode,
                      previewPageIndex: previewPageIndex,
                      handleCloseSurveyPopup: () => {
                          removeSurveyFromFocus(survey.id)
                          dismissedSurveyEvent(survey, posthog, isPreviewMode)
                      },
                  },
              },
              !shouldShowConfirmation
                  ? h(Questions, {
                        survey,
                        forceDisableHtml: !!forceDisableHtml,
                        posthog,
                        styleOverrides: style,
                        removeSurveyFromFocus,
                    })
                  : h(ConfirmationMessage, {
                        header: survey.appearance?.thankYouMessageHeader || 'Thank you!',
                        description: survey.appearance?.thankYouMessageDescription || '',
                        forceDisableHtml: !!forceDisableHtml,
                        contentType: survey.appearance?.thankYouMessageDescriptionContentType,
                        appearance: survey.appearance || defaultSurveyAppearance,
                        styleOverrides: { ...style, ...confirmationBoxLeftStyle },
                        onClose: () => setIsPopupVisible(false),
                    })
          )
        : null
}

// return isPopupVisible ? (
//     <SurveyContext.Provider
//         value={{
//             isPreviewMode,
//             previewPageIndex: previewPageIndex,
//             handleCloseSurveyPopup: () => {
//                 removeSurveyFromFocus(survey.id)
//                 dismissedSurveyEvent(survey, posthog, isPreviewMode)
//             },
//         }}
//     >
//         {!shouldShowConfirmation ? (
//             <Questions
//                 survey={survey}
//                 forceDisableHtml={!!forceDisableHtml}
//                 posthog={posthog}
//                 styleOverrides={style}
//                 removeSurveyFromFocus={removeSurveyFromFocus}
//             />
//         ) : (
//             <ConfirmationMessage
//                 header={survey.appearance?.thankYouMessageHeader || 'Thank you!'}
//                 description={survey.appearance?.thankYouMessageDescription || ''}
//                 forceDisableHtml={!!forceDisableHtml}
//                 contentType={survey.appearance?.thankYouMessageDescriptionContentType}
//                 appearance={survey.appearance || defaultSurveyAppearance}
//                 styleOverrides={{ ...style, ...confirmationBoxLeftStyle }}
//                 onClose={() => setIsPopupVisible(false)}
//             />
//         )}
//     </SurveyContext.Provider>
// ) : (
//     <></>
// )
// }
