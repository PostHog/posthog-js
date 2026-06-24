import { window } from '@posthog/browser-common/utils/globals'
import { SurveyAppearance } from '../../../posthog-surveys-types'

import { useContext } from 'preact/hooks'
import { SurveyContext } from '../surveys-extension-utils'
import { PostHogLogo } from './PostHogLogo'

export function BottomSection({
    text,
    submitDisabled,
    appearance,
    onSubmit,
    link,
    onPreviewSubmit,
    skipSubmitButton,
    canGoBack,
    onBack,
}: {
    text: string
    submitDisabled: boolean
    appearance: SurveyAppearance
    onSubmit: () => void
    link?: string | null
    onPreviewSubmit?: () => void
    skipSubmitButton?: boolean
    canGoBack?: boolean
    onBack?: () => void
}) {
    const { isPreviewMode } = useContext(SurveyContext)
    const showBackButton = !!canGoBack && !!onBack
    const submitButton = !skipSubmitButton && (
        <button
            className="form-submit"
            disabled={submitDisabled}
            aria-label="Submit survey"
            type="button"
            onClick={() => {
                if (link) {
                    window?.open(link)
                }
                if (isPreviewMode) {
                    onPreviewSubmit?.()
                } else {
                    onSubmit()
                }
            }}
        >
            {text}
        </button>
    )
    return (
        <div className="bottom-section">
            {showBackButton ? (
                <div className="form-buttons form-buttons-with-back">
                    <button className="form-back" type="button" aria-label="Go to previous question" onClick={onBack}>
                        {appearance.backButtonText || 'Back'}
                    </button>
                    {submitButton}
                </div>
            ) : (
                submitButton
            )}
            {!appearance.whiteLabel && <PostHogLogo urlParams={{ utm_source: 'survey-footer' }} />}
        </div>
    )
}
