import { shouldIgnoreScreen } from '../../src/autocapture/utils'

describe('shouldIgnoreScreen', () => {
  it('returns true if the route name is in the ignore list (case-sensitive)', () => {
    expect(shouldIgnoreScreen('home', ['home', 'settings'])).toBe(true)
    expect(shouldIgnoreScreen('settings', ['home', 'settings'])).toBe(true)
  })

  it('returns true if the route name is in the ignore list (case-insensitive)', () => {
    expect(shouldIgnoreScreen('Home', ['home', 'settings'])).toBe(true)
    expect(shouldIgnoreScreen('home', ['Home', 'settings'])).toBe(true)
    expect(shouldIgnoreScreen('SETTINGS', ['home', 'settings'])).toBe(true)
  })

  it('returns false if the route name is not in the ignore list', () => {
    expect(shouldIgnoreScreen('profile', ['home', 'settings'])).toBe(false)
  })

  it('handles empty or undefined route name gracefully', () => {
    expect(shouldIgnoreScreen('', ['home'])).toBe(false)
    expect(shouldIgnoreScreen(undefined as any, ['home'])).toBe(false)
  })

  it('handles empty or undefined ignore list gracefully', () => {
    expect(shouldIgnoreScreen('home', undefined)).toBe(false)
    expect(shouldIgnoreScreen('home', [])).toBe(false)
  })

  it('handles ignore list containing undefined/null values gracefully', () => {
    expect(shouldIgnoreScreen('home', [undefined as any, null as any, 'home'])).toBe(true)
  })

  describe('unicode and non-Cyrillic support', () => {
    it('handles Greek screen names case-insensitively', () => {
      expect(shouldIgnoreScreen('αρχική', ['ΑΡΧΙΚΉ'])).toBe(true) // uppercase Eta with tonos matches
      expect(shouldIgnoreScreen('ρυθμίσεις', ['ΡΥΘΜΊΣΕΙΣ'])).toBe(true) // uppercase Iota with tonos matches
      expect(shouldIgnoreScreen('αρχική', ['ΑΡΧΙΚΗ'])).toBe(false) // without tonos does not match
    })

    it('handles Japanese screen names correctly', () => {
      expect(shouldIgnoreScreen('ホーム', ['ホーム'])).toBe(true)
      expect(shouldIgnoreScreen('設定', ['設定'])).toBe(true)
    })

    it('handles Arabic screen names correctly', () => {
      expect(shouldIgnoreScreen('الرئيسية', ['الرئيسية'])).toBe(true)
      expect(shouldIgnoreScreen('الإعدادات', ['الإعدادات'])).toBe(true)
    })

    it('handles screen names with emojis correctly', () => {
      expect(shouldIgnoreScreen('🚀-dashboard', ['🚀-dashboard'])).toBe(true)
      expect(shouldIgnoreScreen('🔥-feed', ['🔥-feed'])).toBe(true)
    })
  })

  describe('partial match checks', () => {
    it('returns false for partial matches', () => {
      expect(shouldIgnoreScreen('home-page', ['home'])).toBe(false)
      expect(shouldIgnoreScreen('home', ['home-page'])).toBe(false)
      expect(shouldIgnoreScreen('αρχική-ρυθμίσεις', ['αρχική'])).toBe(false)
    })
  })
})
