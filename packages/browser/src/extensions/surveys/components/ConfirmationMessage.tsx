import { h } from 'preact'
import { SurveyAppearance, SurveyQuestionDescriptionContentType } from '../../../posthog-surveys-types'
import { renderChildrenAsTextOrHtml } from '../surveys-extension-utils'
import { BottomSection } from './BottomSection'
import { Cancel } from './QuestionHeader'

import { useContext, useEffect } from 'preact/hooks'
import { SurveyContext } from '../surveys-extension-utils'
import { addEventListener } from '../../../utils'
import { window as _window } from '../../../utils/globals'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window

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

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault()
                onClose()
            }
        }
        addEventListener(window, 'keydown', handleKeyDown as EventListener)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [onClose])

    return (
        <div className="thank-you-message" role="status" tabIndex={0} aria-atomic="true">
            {isPopup && <Cancel onClick={() => onClose()} />}
            <h3 className="thank-you-message-header">{header}</h3>
            {description &&
                renderChildrenAsTextOrHtml({
                    component: h('p', { className: 'thank-you-message-body' }),
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
    )
}
