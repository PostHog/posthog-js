import { RefObject } from 'preact'
import { window } from '../../../utils/globals'

import { SurveyAppearance } from '../../../posthog-surveys-types'

import { useContrastingTextColor } from '../hooks/useContrastingTextColor'
import { PostHogLogo } from './PostHogLogo'
import { SurveyContext } from '../../surveys'
import { useContext } from 'preact/hooks'

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
    const { readOnly } = useContext(SurveyContext)

    return (
        <div className="bottom-section">
            <div className="buttons">
                <button
                    className="form-submit"
                    ref={ref as RefObject<HTMLButtonElement>}
                    disabled={submitDisabled || readOnly}
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
