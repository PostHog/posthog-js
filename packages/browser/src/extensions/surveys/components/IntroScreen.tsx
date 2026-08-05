import { h } from 'preact'
import { SurveyAppearance, SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { renderChildrenAsTextOrHtml } from '../surveys-extension-utils'
import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'

import { useContext, useEffect } from 'preact/hooks'
import { SurveyContext } from '../surveys-extension-utils'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { window as _window } from '@posthog/browser-common/utils/globals'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window

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
    const { isPopup, isPreviewMode, onPreviewSubmit, onPopupSurveyDismissed } = useContext(SurveyContext)

    useEffect(() => {
        // Escape is intentionally not bound: unlike the confirmation message (where the survey is
        // already complete), leaving the intro dismisses the whole survey, which must stay an
        // explicit action via the cancel button. In preview mode the parent owns navigation, and a
        // window-level listener would hijack Enter presses in the surrounding editor UI.
        if (isPreviewMode) {
            return
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault()
                onStart()
            }
        }
        addEventListener(window, 'keydown', handleKeyDown as EventListener)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [isPreviewMode, onStart])

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
