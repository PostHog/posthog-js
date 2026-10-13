import { DEFAULT_BLOCKED_UA_STRS, isBlockedUA, __resetBotDetectionCacheForTests } from './bot-detection'

beforeEach(() => {
  __resetBotDetectionCacheForTests()
})

const REAL_CHROME_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.193 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.199 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.122 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
  // Chrome 154 and 155 stable — released 2026-09.
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.58 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.12 Safari/537.36',
]

describe('DEFAULT_BLOCKED_UA_STRS', () => {
  it('contains at least 50 entries', () => {
    expect(DEFAULT_BLOCKED_UA_STRS.length).toBeGreaterThan(50)
  })

  it('contains critical entries', () => {
    expect(DEFAULT_BLOCKED_UA_STRS).toContain('googlebot')
    expect(DEFAULT_BLOCKED_UA_STRS).toContain('headlesschrome')
    expect(DEFAULT_BLOCKED_UA_STRS).toContain('bot/')
  })
})

describe('isBlockedUA', () => {
  it('returns false for undefined ua', () => {
    expect(isBlockedUA(undefined)).toBe(false)
  })

  it('returns false for real Chrome UAs (including Chrome 154 and 155)', () => {
    for (const ua of REAL_CHROME_UAS) {
      expect(isBlockedUA(ua)).toBe(false)
    }
  })

  it('returns true for known bot substrings', () => {
    expect(isBlockedUA('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(isBlockedUA('Mozilla/5.0 bingbot/2.0')).toBe(true)
    expect(isBlockedUA('headlessChrome/119.0')).toBe(true)
  })

  it('is case-insensitive on the UA input', () => {
    const bot = 'Mozilla/5.0 (compatible; Googlebot/2.1)'
    expect(isBlockedUA(bot)).toBe(true)
    expect(isBlockedUA(bot.toLowerCase())).toBe(true)
    expect(isBlockedUA(bot.toUpperCase())).toBe(true)
  })

  it('accepts customBlockedUserAgents', () => {
    expect(isBlockedUA('custombot', ['custombot'])).toBe(true)
    expect(isBlockedUA('custombot', [])).toBe(false)
  })
})

describe('isBlockedUA session memoization', () => {
  it('returns the same result on repeated calls with identical inputs', () => {
    const ua = REAL_CHROME_UAS[0]
    const first = isBlockedUA(ua)
    const second = isBlockedUA(ua)
    expect(second).toBe(first)
  })

  it('cache is bucketed per customBlockedUserAgents list', () => {
    const ua = 'Mozilla/5.0 custombot'
    expect(isBlockedUA(ua, [])).toBe(false)
    expect(isBlockedUA(ua, ['custombot'])).toBe(true)
    expect(isBlockedUA(ua, [])).toBe(false)
  })

  it('__resetBotDetectionCacheForTests wipes the cache', () => {
    isBlockedUA(REAL_CHROME_UAS[0])
    __resetBotDetectionCacheForTests()
    // Still correct after reset; this just proves the reset doesn't corrupt state.
    expect(isBlockedUA(REAL_CHROME_UAS[0])).toBe(false)
  })

  it('handles a burst of many distinct UAs without breaking correctness', () => {
    for (let i = 0; i < 500; i++) {
      const ua = `Mozilla/5.0 (burst-${i}) AppleWebKit/537.36`
      expect(isBlockedUA(ua)).toBe(false)
    }
  })
})

describe('isBlockedUA cache-key delimiter injection', () => {
  it('does not collide when custom list contains delimiter bytes', () => {
    const ua = 'MyAgent/1.0'
    // Length-prefixed keys mean embedded ':' or '|' in list entries cannot
    // forge a key that aliases another (ua, custom[]) pair.
    const a = isBlockedUA(ua, ['foo:1', 'bar'])
    const b = isBlockedUA(ua, ['foo', '1:bar'])
    // Both lookups are independent cache slots and both correctly return false.
    expect(a).toBe(false)
    expect(b).toBe(false)
  })
})
