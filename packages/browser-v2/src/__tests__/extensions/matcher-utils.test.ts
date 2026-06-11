import { doesDeviceTypeMatch } from '../../extensions/utils/matcher-utils'
import * as globals from '../../utils/globals'

const DESKTOP_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36'
const MOBILE_UA =
    'Mozilla/5.0 (Linux; U; Android-4.0.3; en-us; Galaxy Nexus Build/IML74K) AppleWebKit/535.7 (KHTML, like Gecko) CrMo/16.0.912.75 Mobile Safari/535.7'
const TABLET_UA =
    'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'

function setUserAgent(ua: string | undefined) {
    // @ts-expect-error - overriding readonly export for testing
    globals['userAgent'] = ua
}

describe('doesDeviceTypeMatch', () => {
    const originalUA = globals.userAgent
    afterEach(() => setUserAgent(originalUA as string | undefined))

    it.each([
        ['no device types', undefined, DESKTOP_UA, true],
        ['empty device types', [], DESKTOP_UA, true],
        ['no userAgent', ['Desktop'], undefined, false],
        ['Desktop matches desktop UA', ['Desktop'], DESKTOP_UA, true],
        ['Mobile matches mobile UA', ['Mobile'], MOBILE_UA, true],
        ['Tablet matches tablet UA', ['Tablet'], TABLET_UA, true],
        ['Mobile does not match desktop UA', ['Mobile'], DESKTOP_UA, false],
        ['Desktop does not match mobile UA', ['Desktop'], MOBILE_UA, false],
        ['any match in list suffices', ['Desktop', 'Mobile'], MOBILE_UA, true],
        ['no match in list', ['Mobile', 'Tablet'], DESKTOP_UA, false],
        ['case-insensitive by default', ['desktop'], DESKTOP_UA, true],
    ] as const)('%s → %s', (_label, deviceTypes, ua, expected) => {
        setUserAgent(ua)
        expect(doesDeviceTypeMatch(deviceTypes as string[] | undefined)).toBe(expected)
    })

    it('exact match type is case-sensitive', () => {
        setUserAgent(DESKTOP_UA)
        expect(doesDeviceTypeMatch(['Desktop'], 'exact')).toBe(true)
        expect(doesDeviceTypeMatch(['desktop'], 'exact')).toBe(false)
    })
})
