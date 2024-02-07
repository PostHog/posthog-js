import * as Preact from 'preact'
import { window } from '../../../utils/globals'

import { SurveyAppearance } from '../../../posthog-surveys-types'

import { useContrastingTextColor } from '../hooks/useContrastingTextColor'
import { PostHogLogo } from './PostHogLogo'

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
    const { textColor, ref } = useContrastingTextColor({ appearance })

    return (
        <div className="bottom-section">
            <div className="buttons">
                <button
                    className="form-submit"
                    ref={ref as Preact.RefObject<HTMLButtonElement>}
                    disabled={submitDisabled}
                    type="button"
                    style={{ color: textColor }}
                    onClick={() => {
                        if (link) {
                            window?.open(link)
                        }
                        onSubmit()
                    }}
                >
                    {text}
                </button>
            </div>
            {!appearance.whiteLabel && <PostHogLogo backgroundColor={appearance.backgroundColor || '#FF'} />}
        </div>
    )
}
