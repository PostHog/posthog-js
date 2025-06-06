import { h } from 'preact'
import { SurveyAppearance, SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { renderChildrenAsTextOrHtml } from '../surveys-extension-utils'
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
}: {
    header: string
    description: string
    forceDisableHtml: boolean
    contentType?: SurveyQuestionDescriptionContentType
    appearance: SurveyAppearance
    onClose: () => void
}) {
    const { isPopup } = useContext(SurveyContext)

    return (
        <div className="thank-you-message">
            {isPopup && <Cancel onClick={() => onClose()} />}
            <div className="thank-you-message-container">
                <h3 className="thank-you-message-header">{header}</h3>
                {description &&
                    renderChildrenAsTextOrHtml({
                        component: h('div', { className: 'thank-you-message-body' }),
                        children: description,
                        renderAsHtml: !forceDisableHtml && contentType !== 'text',
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
