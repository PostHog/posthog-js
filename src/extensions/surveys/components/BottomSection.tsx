import { window } from '../../../utils/globals'

import { SurveyAppearance } from '../../../posthog-surveys-types'

import { useContext } from 'preact/hooks'
import { SurveyContext, defaultSurveyAppearance, getContrastingTextColor } from '../surveys-utils'
import { PostHogLogo } from './PostHogLogo'

export function BottomSection({
    text,
    submitDisabled,
    appearance,
    onSubmit,
    link,
    onPreviewSubmit,
}: {
    text: string
    submitDisabled: boolean
    appearance: SurveyAppearance
    onSubmit: () => void
    link?: string | null
    onPreviewSubmit?: () => void
}) {
    const { isPreviewMode, isPopup } = useContext(SurveyContext)
    const textColor =
        appearance.submitButtonTextColor ||
        getContrastingTextColor(appearance.submitButtonColor || defaultSurveyAppearance.submitButtonColor)
    return (
        <div className="bottom-section">
            <div className="buttons">
                <button
                    className="form-submit"
                    disabled={submitDisabled}
                    aria-label="Submit survey"
                    type="button"
                    style={isPopup ? { color: textColor } : {}}
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
            </div>
            {!appearance.whiteLabel && <PostHogLogo />}
        </div>
    )
}
