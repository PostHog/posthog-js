import { IconPosthogLogo } from '../icons'

interface PostHogLogoProps {
    urlParams?: Record<string, string>
}

export function PostHogLogo({ urlParams }: PostHogLogoProps) {
    // Manual query string building for IE11/op_mini compatibility (no URLSearchParams)
    const queryString = urlParams
        ? Object.entries(urlParams)
              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
              .join('&')
        : ''

    return (
        <a
            href={`https://posthog.com/surveys${queryString ? `?${queryString}` : ''}`}
            target="_blank"
            rel="noopener"
            className="footer-branding"
        >
            Survey by {IconPosthogLogo}
        </a>
    )
}
