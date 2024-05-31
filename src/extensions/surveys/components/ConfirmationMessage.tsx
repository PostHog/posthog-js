import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'
import { SurveyAppearance, SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { defaultSurveyAppearance, getContrastingTextColor } from '../surveys-utils'

export function ConfirmationMessage({
    confirmationHeader,
    confirmationDescription,
    confirmationDescriptionContentType,
    appearance,
    onClose,
    styleOverrides,
}: {
    confirmationHeader: string
    confirmationDescription: string
    confirmationDescriptionContentType?: SurveyQuestionDescriptionContentType
    appearance: SurveyAppearance
    onClose: () => void
    styleOverrides?: React.CSSProperties
}) {
    const textColor = getContrastingTextColor(appearance.backgroundColor || defaultSurveyAppearance.backgroundColor)

    return (
        <>
            <div className="thank-you-message" style={{ ...styleOverrides }}>
                <div className="thank-you-message-container">
                    <Cancel onClick={() => onClose()} />
                    <h3 className="thank-you-message-header" style={{ color: textColor }}>
                        {confirmationHeader}
                    </h3>
                    {confirmationDescription ? (
                        confirmationDescriptionContentType === 'text' ? (
                            <div style={{ color: textColor }} className="thank-you-message-body">
                                {confirmationDescription}
                            </div>
                        ) : (
                            // Treat as HTML if content type is 'html' or not specified
                            <div
                                style={{ color: textColor }}
                                className="thank-you-message-body"
                                dangerouslySetInnerHTML={{ __html: confirmationDescription }}
                            />
                        )
                    ) : null}
                    <BottomSection
                        text={'Close'}
                        submitDisabled={false}
                        appearance={appearance}
                        onSubmit={() => onClose()}
                    />
                </div>
            </div>
        </>
    )
}
