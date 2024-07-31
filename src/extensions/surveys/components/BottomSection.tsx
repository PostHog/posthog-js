import { window } from '../../../utils/globals'

import { SurveyAppearance } from '../../../posthog-surveys-types'

import { PostHogLogo } from './PostHogLogo'
import { useContext } from 'preact/hooks'
import { SurveyContext, defaultSurveyAppearance, getContrastingTextColor } from '../surveys-utils'

export function BottomSection({
    text,
    submitDisabled,
    appearance,
    onSubmit,
    link,
}: {
    text: string
    submitDisabled: boolean
    appearance: SurveyAppearance
    onSubmit: () => void
    link?: string | null
}) {
    const { isPreviewMode, isPopup } = useContext(SurveyContext)
    const textColor = getContrastingTextColor(appearance.submitButtonColor || defaultSurveyAppearance.submitButtonColor)
    return (
        <div className="bottom-section">
            <div className="buttons">
                <button
                    className="form-submit"
                    disabled={submitDisabled && !isPreviewMode}
                    type="button"
                    style={isPopup ? { color: textColor } : {}}
                    onClick={() => {
                        if (isPreviewMode) return
                        if (link) {
                            window?.open(link)
                        }
                        onSubmit()
                    }}
                >
                    {text}
                </button>
            </div>
            {!appearance.whiteLabel && <PostHogLogo />}
        </div>
    )
}
