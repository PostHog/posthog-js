export const DEFAULT_BLOCKED_UA_STRS = [
    'ahrefsbot',
    'applebot',
    'baiduspider',
    'bingbot',
    'bingpreview',
    'bot.htm',
    'bot.php',
    'crawler',
    'duckduckbot',
    'facebookexternal',
    'facebookcatalog',
    'gptbot',
    'hubspot',
    'linkedinbot',
    'mj12bot',
    'petalbot',
    'pinterest',
    'prerender',
    'rogerbot',
    'screaming frog',
    'semrushbot',
    'sitebulb',
    'twitterbot',
    'yahoo! slurp',
    'yandexbot',

    // a whole bunch of goog-specific crawlers
    // https://developers.google.com/search/docs/advanced/crawling/overview-google-crawlers
    'adsbot-google',
    'apis-google',
    'duplexweb-google',
    'feedfetcher-google',
    'google favicon',
    'google web preview',
    'google-read-aloud',
    'googlebot',
    'googleweblight',
    'mediapartners-google',
    'storebot-google',
]

// _.isBlockedUA()
// This is to block various web spiders from executing our JS and
// sending false capturing data
export const _isBlockedUA = function (ua: string, customBlockedUserAgents: string[]): boolean {
    if (!ua) {
        return false
    }
    const uaLower = ua.toLowerCase()
    return DEFAULT_BLOCKED_UA_STRS.concat(customBlockedUserAgents || []).some((blockedUA) => {
        const blockedUaLower = blockedUA.toLowerCase()
        if (uaLower.includes) {
            return uaLower.includes(blockedUaLower)
        } else {
            // IE 11 :/
            return uaLower.indexOf(blockedUaLower) !== -1
        }
    })
}
