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
 * Chrome/MAJOR.MINOR.BUILD.PATCH regex. Compiled once at module load so heuristic
 * paths on hot event capture do not allocate a new RegExp per event. Case-sensitive
 * because real Chrome UAs always capitalize the token; case-folding would weaken
 * the signal on evasive strings that lower-case the marker on purpose.
 */
const CHROME_VERSION_RE = /Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/

/**
 * Configuration options for heuristic bot detection.
 *
 * Heuristics are opt-in and disabled by default to preserve existing behavior.
 * 'strict' mode catches more bots at the cost of higher false-positive risk;
 * 'balanced' aims for a practical middle ground.
 */
export interface HeuristicBotDetectionOptions {
  /** Heuristics mode: 'off' (default, preserves existing behavior), 'balanced', or 'strict' */
  heuristics?: 'off' | 'balanced' | 'strict'
  /**
   * Custom Chrome version thresholds for impossible-version detection.
   * The only field is `maxKnownPatch`. Build number is intentionally not
   * gated here — see the docstring on `isImpossibleChromeVersion` for the
   * reasoning (Chrome's build number grows monotonically with every
   * release; any static ceiling ages into false positives).
   */
  extraChromeVersionRules?: {
    /**
     * Maximum known Chrome patch number (default: 1000). Real Chrome has
     * never released a 4-digit patch; the #2921 botnet range was 1037-1991.
     * Callers rarely need to override.
     */
    maxKnownPatch?: number
  }
}

/**
 * Result of heuristic bot scoring.
 *
 * The score ranges from 0-100 where higher values indicate higher bot likelihood.
 * Reasons provide human-readable explanations for each signal that contributed.
 */
export interface HeuristicBotScoreResult {
  /** Score from 0-100, higher = more likely bot */
  score: number
  /** Human-readable reasons contributing to the score */
  reasons: string[]
}

/**
 * Session-level memoization for isBlockedUA.
 *
 * `navigator.userAgent` is constant across all events captured in a browser
 * session, and PostHog's autocapture path calls isBlockedUA on every event.
 * Real-world hit rate after event 1 is effectively 100% within a session, so
 * memoizing the boolean result skips the entire substring-scan + heuristic
 * pass on subsequent calls — for a session with N events this turns an O(N)
 * cost into O(1).
 *
 * The map is keyed by `ua + delimiter + configSignature` so a config change
 * (different opts.heuristics or customBlockedUserAgents) yields a fresh
 * cache slot without wiping unrelated entries. If the cache grows beyond
 * MAX_CACHE_ENTRIES we drop it entirely — the assumption is that in a
 * healthy session the effective set of (ua, config) pairs is O(1); growth
 * past the ceiling signals unusual churn where correctness beats cache.
 */
const UA_CACHE = new Map<string, boolean>()
const MAX_CACHE_ENTRIES = 256

/**
 * Exposed for tests only: clears the memoization cache. Not part of the
 * public API; do not rely on it in application code.
 */
export function __resetBotDetectionCacheForTests(): void {
  UA_CACHE.clear()
}

function buildCacheKey(
  ua: string,
  custom: string[],
  opts: HeuristicBotDetectionOptions
): string {
  const heuristics = opts.heuristics ?? 'off'
  const rules = opts.extraChromeVersionRules
  const maxPatch = rules && rules.maxKnownPatch !== undefined ? rules.maxKnownPatch : ''
  // Length-prefixed encoding — collision-free regardless of what bytes appear
  // inside ua or custom entries (control-char delimiters are not sufficient
  // because a caller could pass such bytes in customBlockedUserAgents).
  // Each field is prefixed with its length so field boundaries are unambiguous.
  let customEncoded = ''
  for (let i = 0; i < custom.length; i++) {
    const c = custom[i]
    customEncoded += c.length + ':' + c
  }
  return ua.length + ':' + ua + '|' + heuristics + '|' + maxPatch + '|' + custom.length + ':' + customEncoded
}

/**
 * Checks if a Chrome version in the user agent has impossible version numbers.
 *
 * Grounded in the analysis published on issue #2921:
 *   Real Chrome patch numbers historically fall in the range 33-244 (highest
 *   legitimate value observed ~500). The 436 flagged bots in #2921 all had a
 *   patch number in 1037-1991. 100% of bot traffic had a 4-digit patch;
 *   legitimate Chrome has never released one.
 *
 * We deliberately do NOT gate on the BUILD number. Chrome's build number
 * grows monotonically with every release (Chrome 154 = 8037, Chrome 155 =
 * 8059, Chrome 156 dev = 8073, etc.), so any hard-coded ceiling would age
 * into false positives against real users. Enterprises that want to enforce
 * a build allow-list can layer it on top externally.
 *
 * @param ua - User agent string to check
 * @param maxKnownPatch - Maximum known legitimate patch number (default: 1000)
 * @returns true if the Chrome version appears impossible/fake
 *
 * @example
 * ```ts
 * isImpossibleChromeVersion('Mozilla/5.0 Chrome/143.0.7499.193 Safari/537.36')  // false
 * isImpossibleChromeVersion('Mozilla/5.0 Chrome/155.0.8059.12 Safari/537.36')   // false (live Chrome 155)
 * isImpossibleChromeVersion('Mozilla/5.0 Chrome/143.0.7499.1037 Safari/537.36') // true (patch >= 1000)
 * ```
 */
export function isImpossibleChromeVersion(
  ua: string,
  maxKnownPatch: number = 1000
): boolean {
  if (!ua) {
    return false
  }

  // Match Chrome/MAJOR.MINOR.BUILD.PATCH pattern using the module-level regex.
  // The regex itself is the presence check: no match → not a Chrome UA → return false.
  const chromeMatch = CHROME_VERSION_RE.exec(ua)
  if (!chromeMatch) {
    return false
  }

  const major = parseInt(chromeMatch[1], 10)
  const patch = parseInt(chromeMatch[4], 10)

  // Sanity check: major version should be reasonable (Chrome started at 1, currently ~155).
  // Threshold 300 is an extreme sanity ceiling; not a strong signal on its own.
  if (major < 1 || major > 300) {
    return true
  }
  // The only load-bearing rule from #2921: real Chrome has never released a
  // 4-digit patch; 100% of the flagged bots had one.
  if (patch >= maxKnownPatch) {
    return true
  }

  return false
}

/**
 * Calculates a heuristic bot score for a user agent string.
 * Pure function: no side effects, no throws.
 *
 * @param ua - User agent string to analyze
 * @param opts - Configuration options for heuristic detection
 * @returns Score (0-100) and reasons array
 *
 * @example
 * ```ts
 * heuristicBotScore('Mozilla/5.0 Chrome/143.0.7499.193 Safari/537.36', { heuristics: 'balanced' })
 * // { score: 0, reasons: [] }
 *
 * heuristicBotScore('Mozilla/5.0 Chrome/143.0.7499.1037 Safari/537.36', { heuristics: 'strict' })
 * // { score: 90, reasons: ['Impossible Chrome version: build=7499, patch=1037...'] }
 * ```
 */
export function heuristicBotScore(
  ua: string | undefined,
  opts: HeuristicBotDetectionOptions = {}
): HeuristicBotScoreResult {
  const reasons: string[] = []
  let score = 0

  if (!ua) {
    return { score: 0, reasons: [] }
  }

  const { heuristics = 'off', extraChromeVersionRules = {} } = opts
  const maxKnownPatch = extraChromeVersionRules.maxKnownPatch ?? 1000

  // Heuristics disabled by default (backwards compatible)
  if (heuristics === 'off') {
    return { score: 0, reasons: [] }
  }

  const uaLower = ua.toLowerCase()

  // Rule 1: Impossible Chrome version (highest confidence signal).
  // Source: #2921 — 100% of the flagged bots had a 4-digit patch number;
  // real Chrome has never released one. The regex runs once and the same
  // match feeds both the impossible-check and the reason string, so a
  // strict-mode pass never runs the regex twice per event.
  const chromeMatch = CHROME_VERSION_RE.exec(ua)
  if (chromeMatch) {
    const major = parseInt(chromeMatch[1], 10)
    const patch = parseInt(chromeMatch[4], 10)
    const impossibleChrome = major < 1 || major > 300 || patch >= maxKnownPatch
    if (impossibleChrome) {
      reasons.push(
        `Impossible Chrome version: patch=${patch} (max known patch=${maxKnownPatch})`
      )
      score += heuristics === 'strict' ? 90 : 70
    }
  }

  // Rule 2: Headless Chrome indicator
  // Source: Existing DEFAULT_BLOCKED_UA_STRS includes 'headlesschrome'
  if (uaLower.indexOf('headlesschrome') !== -1) {
    reasons.push('Headless Chrome detected')
    score += heuristics === 'strict' ? 60 : 40
  }

  // Rule 3: WebDriver property (checked elsewhere, but UA may contain it)
  if (uaLower.indexOf('webdriver') !== -1) {
    reasons.push('WebDriver indicator in UA')
    score += heuristics === 'strict' ? 50 : 30
  }

  // Rule 4: Suspicious automation tools in UA
  // 'webdriver' removed (covered by Rule 3); 'cypress' removed (covered by Rule 6)
  const automationTools = ['puppeteer', 'playwright', 'selenium']
  for (const tool of automationTools) {
    if (uaLower.indexOf(tool) !== -1) {
      reasons.push(`Automation tool detected: ${tool}`)
      score += heuristics === 'strict' ? 40 : 25
      break // Only count once
    }
  }

  // Rule 5: Missing or suspicious browser engine details
  // Real Chrome UAs typically contain AppleWebKit and Safari tokens.
  // Weakened: legitimate WebView apps may omit these, so low weight only.
  const hasChrome = uaLower.indexOf('chrome/') !== -1
  const hasWebKit = uaLower.indexOf('applewebkit/') !== -1
  const hasSafari = uaLower.indexOf('safari/') !== -1

  if (hasChrome && (!hasWebKit || !hasSafari)) {
    reasons.push('Chrome UA missing WebKit/Safari tokens')
    score += heuristics === 'strict' ? 10 : 5
  }

  // Rule 6: Known bot substrings (from DEFAULT_BLOCKED_UA_STRS) - lightweight check
  // Only check a subset of high-confidence bot indicators to avoid false positives
  // 'cypress' included here; removed from Rule 4 to deduplicate
  const highConfidenceBotStrs = [
    'bot.htm', 'bot.php', '(bot;', 'bot/', 'crawler',
    'googlebot', 'bingbot', 'yandexbot', 'baiduspider',
    'facebookexternal', 'twitterbot', 'linkedinbot',
    'headlesschrome', 'cypress'
  ]
  for (const botStr of highConfidenceBotStrs) {
    if (uaLower.indexOf(botStr) !== -1) {
      reasons.push(`Known bot substring: ${botStr}`)
      score += heuristics === 'strict' ? 35 : 20
      break // Only count once
    }
  }

  // Cap score at 100
  if (score > 100) {
    score = 100
  }

  return { score, reasons }
}

/**
 * Block various web spiders from executing our JS and sending false capturing data.
 * Extended with optional heuristic bot detection (opt-in via config).
 *
 * @param ua - User agent string to check
 * @param customBlockedUserAgents - Additional UA substrings to block
 * @param opts - Heuristic detection options (mode, custom thresholds)
 * @returns true if the UA should be blocked
 *
 * @example
 * ```ts
 * // Traditional blocklist only (default behavior)
 * isBlockedUA('Mozilla/5.0 (compatible; Googlebot/2.1)')
 * // true
 *
 * // With heuristic detection in balanced mode
 * isBlockedUA('Mozilla/5.0 Chrome/143.0.7499.1037 Safari/537.36', [], { heuristics: 'balanced' })
 * // true (impossible patch number)
 *
 * // Strict mode catches more
 * isBlockedUA('Mozilla/5.0 Chrome/143.0.7499.193 Safari/537.36', [], { heuristics: 'strict' })
 * // false (legitimate UA)
 * ```
 */
export const isBlockedUA = function (
  ua: string | undefined,
  customBlockedUserAgents: string[] = [],
  opts: HeuristicBotDetectionOptions = {}
): boolean {
  if (!ua) {
    return false
  }

  // Session-level memoization: for a browser session, navigator.userAgent
  // is constant, so the second and later events short-circuit here.
  const key = buildCacheKey(ua, customBlockedUserAgents, opts)
  const cached = UA_CACHE.get(key)
  if (cached !== undefined) {
    return cached
  }

  const result = computeIsBlockedUA(ua, customBlockedUserAgents, opts)

  // Bounded cache: drop the whole map on overflow rather than tracking LRU;
  // in practice a session touches O(1) distinct (ua, config) pairs, so the
  // ceiling is only reached in dynamic-config or test scenarios where
  // correctness matters more than the cache.
  if (UA_CACHE.size >= MAX_CACHE_ENTRIES) {
    UA_CACHE.clear()
  }
  UA_CACHE.set(key, result)
  return result
}

function computeIsBlockedUA(
  ua: string,
  customBlockedUserAgents: string[],
  opts: HeuristicBotDetectionOptions
): boolean {
  const uaLower = ua.toLowerCase()

  // First, check the traditional substring blocklist (existing behavior)
  const blockedByList = DEFAULT_BLOCKED_UA_STRS.concat(customBlockedUserAgents).some((blockedUA) => {
    const blockedUaLower = blockedUA.toLowerCase()
    // can't use includes because IE 11 :/
    return uaLower.indexOf(blockedUaLower) !== -1
  })

  if (blockedByList) {
    return true
  }

  // Then, apply heuristic detection if enabled (opt-in)
  const { heuristics = 'off' } = opts
  if (heuristics !== 'off') {
    // Early exit for strict mode: isImpossibleChromeVersion alone contributes
    // 90 points in strict mode (see heuristicBotScore Rule 1) and the strict
    // block threshold is 40, so a match guarantees a block. This is a private
    // optimization inside isBlockedUA — callers that use the public
    // heuristicBotScore() directly still receive the complete reasons array
    // for the same UA, so observability is not affected.
    if (heuristics === 'strict') {
      const rules = opts.extraChromeVersionRules
      if (isImpossibleChromeVersion(ua, rules?.maxKnownPatch)) {
        return true
      }
    }
    const { score } = heuristicBotScore(ua, opts)
    // Threshold: balanced=60, strict=40
    // Lower threshold for strict = catches more (correct)
    const threshold = heuristics === 'strict' ? 40 : 60
    if (score >= threshold) {
      return true
    }
  }

  return false
}
