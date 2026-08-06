import { isWebKit } from '../utils/browser-utils'

describe('isWebKit', () => {
  it.each([
    ['Safari', 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.4 Safari/605.1.15', true],
    ['Chrome on iOS', 'Mozilla/5.0 AppleWebKit/605.1.15 CriOS/136.0 Mobile/15E148 Safari/604.1', true],
    ['WKWebView', 'Mozilla/5.0 AppleWebKit/605.1.15 Mobile/15E148', true],
    ['desktop Chrome', 'Mozilla/5.0 AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36', false],
  ])('detects %s', (_browser, userAgent, expected) => {
    expect(isWebKit(userAgent)).toBe(expected)
  })
})
