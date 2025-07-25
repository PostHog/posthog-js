export const DEFAULT_BLOCKED_UA_STRS = [
    // Random assortment of bots
    'amazonbot',
    'amazonproductbot',
    'app.hypefactors.com', // Buck, but "buck" is too short to be safe to block (https://app.hypefactors.com/media-monitoring/about.htm)
    'applebot',
    'archive.org_bot',
    'awariobot',
    'backlinksextendedbot',
    'baiduspider',
    'bingbot',
    'bingpreview',
    'chrome-lighthouse',
    'dataforseobot',
    'deepscan',
    'duckduckbot',
    'facebookexternal',
    'facebookcatalog',
    'http://yandex.com/bots',
    'hubspot',
    'ia_archiver',
    'leikibot',
    'linkedinbot',
    'meta-externalagent',
    'mj12bot',
    'msnbot',
    'nessus',
    'petalbot',
    'pinterest',
    'prerender',
    'rogerbot',
    'screaming frog',
    'sebot-wa',
    'sitebulb',
    'slackbot',
    'slurp',
    'trendictionbot',
    'turnitin',
    'twitterbot',
    'vercel-screenshot',
    'vercelbot',
    'yahoo! slurp',
    'yandexbot',
    'zoombot',

    // Bot-like words, maybe we should block `bot` entirely?
    'bot.htm',
    'bot.php',
    '(bot;',
    'bot/',
    'crawler',

    // Ahrefs: https://ahrefs.com/seo/glossary/ahrefsbot
    'ahrefsbot',
    'ahrefssiteaudit',

    // Semrush bots: https://www.semrush.com/bot/
    'semrushbot',
    'siteauditbot',
    'splitsignalbot',

    // AI Crawlers
    'gptbot',
    'oai-searchbot',
    'chatgpt-user',
    'perplexitybot',

    // Uptime-like stuff
    'better uptime bot',
    'sentryuptimebot',
    'uptimerobot',

    // headless browsers
    'headlesschrome',
    'cypress',
    // we don't block electron here, as many customers use posthog-js in electron apps

    // a whole bunch of goog-specific crawlers
    // https://developers.google.com/search/docs/advanced/crawling/overview-google-crawlers
    'google-hoteladsverifier',
    'adsbot-google',
    'apis-google',
    'duplexweb-google',
    'feedfetcher-google',
    'google favicon',
    'google web preview',
    'google-read-aloud',
    'googlebot',
    'googleother',
    'google-cloudvertexbot',
    'googleweblight',
    'mediapartners-google',
    'storebot-google',
    'google-inspectiontool',
    'bytespider',
]

/**
 * Block various web spiders from executing our JS and sending false capturing data
 */
export const isBlockedUA = function (ua: string, customBlockedUserAgents: string[]): boolean {
    if (!ua) {
        return false
    }

    const uaLower = ua.toLowerCase()
    return DEFAULT_BLOCKED_UA_STRS.concat(customBlockedUserAgents || []).some((blockedUA) => {
        const blockedUaLower = blockedUA.toLowerCase()

        // can't use includes because IE 11 :/
        return uaLower.indexOf(blockedUaLower) !== -1
    })
}

// There's more in the type, but this is all we use. It's currently experimental, see
// https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userAgentData
// if you're reading this in the future, when it's no longer experimental, please remove this type and use an official one.
// Be extremely defensive here to ensure backwards and *forwards* compatibility, and remove this defensiveness in the
// future when it is safe to do so.
export interface NavigatorUAData {
    brands?: {
        brand: string
        version: string
    }[]
}
declare global {
    interface Navigator {
        userAgentData?: NavigatorUAData
    }
}

export const isLikelyBot = function (navigator: Navigator | undefined, customBlockedUserAgents: string[]): boolean {
    if (!navigator) {
        return false
    }
    const ua = navigator.userAgent
    if (ua) {
        if (isBlockedUA(ua, customBlockedUserAgents)) {
            return true
        }
    }
    try {
        // eslint-disable-next-line compat/compat
        const uaData = navigator?.userAgentData as NavigatorUAData
        if (uaData?.brands && uaData.brands.some((brandObj) => isBlockedUA(brandObj?.brand, customBlockedUserAgents))) {
            return true
        }
    } catch {
        // ignore the error, we were using experimental browser features
    }

    return !!navigator.webdriver

    // There's some more enhancements we could make in this area, e.g. it's possible to check if Chrome dev tools are
    // open, which will detect some bots that are trying to mask themselves and might get past the checks above.
    // However, this would give false positives for actual humans who have dev tools open.

    // We could also use the data in navigator.userAgentData.getHighEntropyValues() to detect bots, but we should wait
    // until this stops being experimental. The MDN docs imply that this might eventually require user permission.
    // See https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData/getHighEntropyValues
    // It would be very bad if posthog-js caused a permission prompt to appear on every page load.
}
