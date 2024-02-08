import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'
import { SurveyAppearance } from '../../../posthog-surveys-types'
import { useContrastingTextColor } from '../hooks/useContrastingTextColor'
import { RefObject } from 'preact'

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
    const { textColor, ref } = useContrastingTextColor({ appearance })
    return (
        <>
            <div className="thank-you-message" style={{ ...styleOverrides }}>
                <div className="thank-you-message-container">
                    <Cancel onClick={() => onClose()} />
                    <h3
                        className="thank-you-message-header"
                        ref={ref as RefObject<HTMLDivElement>}
                        style={{ color: textColor }}
                    >
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
