import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'
import { SurveyAppearance, SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { defaultSurveyAppearance, getContrastingTextColor, renderChildrenAsTextOrHtml } from '../surveys-utils'
import { h } from 'preact'

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
                    {confirmationDescription &&
                        renderChildrenAsTextOrHtml({
                            component: h('div', { className: 'thank-you-message-body' }),
                            children: confirmationDescription,
                            renderAsHtml: confirmationDescriptionContentType !== 'text',
                            style: { color: textColor },
                        })}
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
