export const DEFAULT_BLOCKED_UA_STRS = [
    'ahrefsbot',
    'ahrefssiteaudit',
    'applebot',
    'baiduspider',
    'bingbot',
    'bingpreview',
    'bot.htm',
    'bot.php',
    'crawler',
    'deepscan',
    'duckduckbot',
    'facebookexternal',
    'facebookcatalog',
    'gptbot',
    'http://yandex.com/bots',
    'hubspot',
    'ia_archiver',
    'linkedinbot',
    'mj12bot',
    'msnbot',
    'nessus',
    'petalbot',
    'pinterest',
    'prerender',
    'rogerbot',
    'screaming frog',
    'semrushbot',
    'sitebulb',
    'slurp',
    'turnitin',
    'twitterbot',
    'vercelbot',
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
    'Bytespider;',
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
