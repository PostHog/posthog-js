// List of blocked user agent strings that identify bots
// This is shared between browser and node SDKs to ensure consistent bot detection
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
  // not the bare 'pinterest' -- that also matches the Pinterest app's own in-app
  // browser UA (e.g. "...Mobile/15D100 [Pinterest/iOS]"), which is a real user,
  // not the crawler. The crawler's other UA variant ("...pinterest.com/bot.html")
  // is still covered by the generic 'bot.htm' entry below.
  'pinterestbot',
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
 * Session-level memoization for isBlockedUA.
 *
 * navigator.userAgent is constant across all events captured in a browser
 * session, and PostHog's autocapture path calls isBlockedUA on every event.
 * Memoizing the boolean result turns an O(N) substring-scan over all N events
 * into O(1) after the first lookup. The map is keyed on (ua, customBlockedUserAgents)
 * — a config change yields a fresh slot. If the cache grows past MAX_CACHE_ENTRIES
 * we drop it entirely (healthy sessions see O(1) distinct keys).
 */
const UA_CACHE = new Map<string, boolean>()
const MAX_CACHE_ENTRIES = 256

/** Exposed for tests only. Not part of the public API. */
export function __resetBotDetectionCacheForTests(): void {
  UA_CACHE.clear()
}

function buildCacheKey(ua: string, custom: string[]): string {
  // Length-prefixed encoding is collision-free regardless of what bytes
  // appear inside ua or custom entries.
  let customEncoded = ''
  for (let i = 0; i < custom.length; i++) {
    const c = custom[i]
    customEncoded += c.length + ':' + c
  }
  return ua.length + ':' + ua + '|' + custom.length + ':' + customEncoded
}

/**
 * Block various web spiders from executing our JS and sending false capturing data.
 *
 * @param ua - User agent string to check
 * @param customBlockedUserAgents - Additional UA substrings to block
 * @returns true if the UA matches a known-bot substring
 */
export const isBlockedUA = function (ua: string | undefined, customBlockedUserAgents: string[] = []): boolean {
  if (!ua) {
    return false
  }

  const key = buildCacheKey(ua, customBlockedUserAgents)
  const cached = UA_CACHE.get(key)
  if (cached !== undefined) {
    return cached
  }

  const uaLower = ua.toLowerCase()
  const result = DEFAULT_BLOCKED_UA_STRS.concat(customBlockedUserAgents).some((blockedUA) => {
    // can't use includes because IE 11 :/
    return uaLower.indexOf(blockedUA.toLowerCase()) !== -1
  })

  if (UA_CACHE.size >= MAX_CACHE_ENTRIES) {
    UA_CACHE.clear()
  }
  UA_CACHE.set(key, result)
  return result
}
