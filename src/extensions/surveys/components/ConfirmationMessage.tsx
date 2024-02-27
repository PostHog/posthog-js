import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'
import { SurveyAppearance } from '../../../posthog-surveys-types'
import { defaultSurveyAppearance, getContrastingTextColor } from '../surveys-utils'

export function ConfirmationMessage({
    confirmationHeader,
    confirmationDescription,
    appearance,
    onClose,
    styleOverrides,
}: {
    confirmationHeader: string
    confirmationDescription: string
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
                    {confirmationDescription && (
                        <div
                            style={{ color: textColor }}
                            className="thank-you-message-body"
                            dangerouslySetInnerHTML={{ __html: confirmationDescription }}
                        />
                    )}
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
