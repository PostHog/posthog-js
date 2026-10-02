import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import type { doesDeviceTypeMatch } from '../../src/utils/matcher-utils'

// Evaluate the built module in its own realm so globalThis can be removed without affecting the test runner.
const entry = new URL('../../dist/utils/matcher-utils.js', import.meta.url)
const source = readFileSync(entry, 'utf8')
const desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
const mobileUserAgent = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'

function loadMatcher(globals: Record<string, unknown>, hasGlobalThis: boolean) {
    const exports = {} as { doesDeviceTypeMatch: typeof doesDeviceTypeMatch }
    const context = createContext({ ...globals, exports, require: createRequire(entry) })
    if (!hasGlobalThis) {
        runInContext('delete this.globalThis', context)
    }
    runInContext(source, context)
    return { matches: exports.doesDeviceTypeMatch, context }
}

describe.each([true, false])('doesDeviceTypeMatch with globalThis=%s', (hasGlobalThis) => {
    it.each([
        [desktopUserAgent, 'Desktop'],
        [mobileUserAgent, 'Mobile'],
    ])('matches the browser device for %s', (userAgent, deviceType) => {
        const navigator = { userAgent }
        const { matches } = loadMatcher({ navigator, window: { navigator } }, hasGlobalThis)
        expect(matches([deviceType])).toBe(true)
        expect(matches(['Tablet'])).toBe(false)
        expect(matches([deviceType.toLowerCase()], 'exact')).toBe(false)
    })

    it('returns false without a browser and true for empty conditions', () => {
        const { matches } = loadMatcher({}, hasGlobalThis)
        expect(matches()).toBe(true)
        expect(matches([])).toBe(true)
        expect(matches(['Desktop'])).toBe(false)
    })

    it('returns false without a user agent', () => {
        const navigator = {}
        const { matches } = loadMatcher({ navigator, window: { navigator } }, hasGlobalThis)
        expect(matches(['Desktop'])).toBe(false)
    })

    it('reads browser capabilities at invocation rather than import', () => {
        const { matches, context } = loadMatcher({}, hasGlobalThis)
        const navigator = { userAgent: desktopUserAgent }
        context.window = { navigator }
        context.navigator = navigator
        expect(matches(['Desktop'])).toBe(true)
    })
})

it('uses window.navigator when globalThis is unavailable', () => {
    const { matches } = loadMatcher({ window: { navigator: { userAgent: desktopUserAgent } } }, false)
    expect(matches(['Desktop'])).toBe(true)
})
