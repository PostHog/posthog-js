import type { BrowserNavigator } from './types'

const BLOCKED_USER_AGENTS = [
    'amazonbot',
    'applebot',
    'archive.org_bot',
    'baiduspider',
    'bingbot',
    'bingpreview',
    'chrome-lighthouse',
    'crawler',
    'duckduckbot',
    'facebookexternal',
    'facebookcatalog',
    'gptbot',
    'googlebot',
    'googleother',
    'headlesschrome',
    'ia_archiver',
    'linkedinbot',
    'meta-externalagent',
    'mj12bot',
    'oai-searchbot',
    'perplexitybot',
    'pinterest',
    'prerender',
    'semrushbot',
    'slackbot',
    'slurp',
    'spider',
    'twitterbot',
    'uptimerobot',
    'vercel-screenshot',
    'vercelbot',
    'yahoo! slurp',
    'yandexbot',
] as const

export const isLikelyBot = (navigator: BrowserNavigator | undefined, blockedUserAgents: readonly string[]): boolean => {
    if (!navigator) {
        return false
    }

    try {
        if (navigator.webdriver) {
            return true
        }

        const userAgent = navigator.userAgent?.toLowerCase()
        return (
            !!userAgent &&
            [...BLOCKED_USER_AGENTS, ...blockedUserAgents].some((value) => userAgent.includes(value.toLowerCase()))
        )
    } catch {
        return false
    }
}
