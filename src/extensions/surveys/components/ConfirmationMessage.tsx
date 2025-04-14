import { h } from 'preact'
import { SurveyAppearance, SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import {
    defaultSurveyAppearance,
    getContrastingTextColor,
    renderChildrenAsTextOrHtml,
} from '../surveys-extension-utils'
import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'

import { useContext } from 'preact/hooks'
import { SurveyContext } from '../surveys-extension-utils'

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

    const { isPopup } = useContext(SurveyContext)

    return (
        <div className="thank-you-message" style={{ ...styleOverrides }}>
            <div className="thank-you-message-container">
                {isPopup && <Cancel onClick={() => onClose()} />}
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
                {isPopup && (
                    <BottomSection
                        text={appearance.thankYouMessageCloseButtonText || 'Close'}
                        submitDisabled={false}
                        appearance={appearance}
                        onSubmit={() => onClose()}
                    />
                )}
            </div>
        </div>
    )
}
