import { isLikelyWebViewBot } from '../../customizations/bot-detection'

const REAL_CHROME_UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.193 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.199 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.122 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
    // Chrome 154 and 155 stable — released 2026-09.
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.58 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.12 Safari/537.36',
]

describe('isLikelyWebViewBot', () => {
    it('returns false for undefined / empty ua', () => {
        expect(isLikelyWebViewBot(undefined)).toBe(false)
        expect(isLikelyWebViewBot('')).toBe(false)
    })

    it('returns false for real Chrome UAs (all three tokens present)', () => {
        for (const ua of REAL_CHROME_UAS) {
            // Note: CriOS/Firefox/IE11 UAs that lack a `Chrome/` token short-circuit
            // to false too, which is the intended behavior for a Chrome-only signal.
            expect(isLikelyWebViewBot(ua)).toBe(false)
        }
    })

    it('returns true when Chrome token is present but WebKit is missing', () => {
        const ua = 'Mozilla/5.0 Chrome/120.0 Safari/537.36'
        expect(isLikelyWebViewBot(ua)).toBe(true)
    })

    it('returns true when Chrome token is present but Safari is missing', () => {
        const ua = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0'
        expect(isLikelyWebViewBot(ua)).toBe(true)
    })

    it('returns false for non-Chrome UAs (Firefox, Safari-only, IE)', () => {
        expect(isLikelyWebViewBot('Mozilla/5.0 Firefox/120.0')).toBe(false)
        expect(isLikelyWebViewBot('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(false)
        expect(isLikelyWebViewBot('Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko')).toBe(false)
    })

    it('case-insensitive', () => {
        const ua = 'MOZILLA/5.0 CHROME/120.0 safari/537.36'
        // Chrome present, AppleWebKit absent → true
        expect(isLikelyWebViewBot(ua)).toBe(true)
    })
})
