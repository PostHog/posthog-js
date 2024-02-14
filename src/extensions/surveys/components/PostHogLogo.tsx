import { IconPosthogLogo } from '../icons'
import { getContrastingTextColor } from '../surveys-utils'

export function PostHogLogo({ backgroundColor }: { backgroundColor: string }) {
    const textColor = getContrastingTextColor(backgroundColor)

    return (
        <a
            href="https://posthog.com"
            target="_blank"
            rel="noopener"
            style={{ backgroundColor: backgroundColor, color: textColor }}
            className="footer-branding"
        >
            Survey by {IconPosthogLogo}
        </a>
    )
}
