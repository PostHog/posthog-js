import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'
import { SurveyAppearance, SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { defaultSurveyAppearance, getContrastingTextColor, renderChildrenAsTextOrHtml } from '../surveys-utils'
import { h } from 'preact'

export function ConfirmationMessage({
    header,
    description,
    contentType,
    forceDisableHtml,
    appearance,
    onClose,
    styleOverrides,
}: {
    header: string
    description: string
    forceDisableHtml: boolean
    contentType?: SurveyQuestionDescriptionContentType
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
                        {header}
                    </h3>
                    {description &&
                        renderChildrenAsTextOrHtml({
                            component: h('div', { className: 'thank-you-message-body' }),
                            children: description,
                            renderAsHtml: !forceDisableHtml && contentType !== 'text',
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
