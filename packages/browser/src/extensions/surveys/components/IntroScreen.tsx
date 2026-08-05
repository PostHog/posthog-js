import { h } from 'preact'
import { SurveyAppearance, SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { renderChildrenAsTextOrHtml } from '../surveys-extension-utils'
import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'

import { useContext } from 'preact/hooks'
import { SurveyContext } from '../surveys-extension-utils'

export function IntroScreen({
    header,
    description,
    contentType,
    forceDisableHtml,
    appearance,
    onStart,
}: {
    header: string
    description: string
    forceDisableHtml: boolean
    contentType?: SurveyQuestionDescriptionContentType
    appearance: SurveyAppearance
    onStart: () => void
}) {
    const { isPopup, onPreviewSubmit, onPopupSurveyDismissed } = useContext(SurveyContext)

    // Unlike the confirmation message, no window-level key handling here: a global Enter
    // listener would advance the intro when the user presses Enter in an unrelated host-page
    // input, and Escape would dismiss the whole survey rather than close a completed one.
    // The advance button is natively keyboard-operable once focused.

    const renderCancelButton = isPopup && appearance.hideCancelButton !== true

    return (
        <div className="intro-screen" role="status" tabIndex={0} aria-atomic="true">
            {renderCancelButton && <Cancel onClick={() => onPopupSurveyDismissed()} />}
            {header && <h3 className="intro-screen-header">{header}</h3>}
            {description &&
                renderChildrenAsTextOrHtml({
                    component: h('p', { className: 'intro-screen-body' }),
                    children: description,
                    renderAsHtml: !forceDisableHtml && contentType !== 'text',
                })}
            <BottomSection
                text={appearance.introScreenButtonText || 'Get started'}
                submitDisabled={false}
                appearance={appearance}
                onSubmit={onStart}
                onPreviewSubmit={() => onPreviewSubmit(null)}
            />
        </div>
    )
}
