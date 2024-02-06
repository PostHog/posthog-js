import { useEffect, useRef, useState } from 'preact/hooks'
import { SurveyAppearance } from '../../../posthog-surveys-types'
import * as Preact from 'preact'
import { getTextColor } from '../surveys-utils'

export function useContrastingTextColor(options: { appearance: SurveyAppearance; defaultTextColor?: string }): {
    ref: Preact.RefObject<HTMLElement>
    textColor: string
} {
    const ref = useRef<HTMLElement>(null)
    const [textColor, setTextColor] = useState(options.defaultTextColor ?? 'white')

    // TODO: useContext to get the background colors instead of querying the DOM
    useEffect(() => {
        if (ref.current) {
            const color = getTextColor(ref.current)
            setTextColor(color)
        }
    }, [options.appearance])

    return {
        ref,
        textColor,
    }
}
