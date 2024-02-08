import { useContrastingTextColor } from '../hooks/useContrastingTextColor'
import * as Preact from 'preact'
import { IconPosthogLogo } from '../icons'

export function PostHogLogo({ backgroundColor }: { backgroundColor?: string }) {
    const { textColor, ref } = useContrastingTextColor({ appearance: { backgroundColor } })

    return (
        <a
            href="https://posthog.com"
            target="_blank"
            rel="noopener"
            ref={ref as Preact.RefObject<HTMLAnchorElement>}
            style={{ backgroundColor: backgroundColor, color: textColor }}
            className="footer-branding"
        >
            Survey by {IconPosthogLogo}
        </a>
    )
}
