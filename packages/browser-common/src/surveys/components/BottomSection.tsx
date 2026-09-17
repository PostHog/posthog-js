import { h } from 'preact'

import type { SurveyAppearance } from '../../types/surveys'

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
    link?: (string | null) | undefined
    onPreviewSubmit?: (() => void) | undefined
    skipSubmitButton?: boolean | undefined
    canGoBack?: boolean | undefined
    onBack?: (() => void) | undefined
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
