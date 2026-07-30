/**
 * @jest-environment jsdom
 */

const SAFARI_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15'
const CHROME_IOS_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/136.0.7103.56 Mobile/15E148 Safari/604.1'
const CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

function setUserAgent(userAgent: string): void {
    Object.defineProperty(window.navigator, 'userAgent', {
        value: userAgent,
        configurable: true,
    })
}

async function getFreshNativeMutationObserver(): Promise<typeof MutationObserver> {
    jest.resetModules()
    const { getNativeMutationObserverImplementation } = await import('../../src/utils/prototype-utils')
    return getNativeMutationObserverImplementation(window)
}

describe('getNativeMutationObserverImplementation iframe fallback', () => {
    const originalUserAgent = window.navigator.userAgent

    beforeEach(() => {
        ;(window as any).Zone = {}
    })

    afterEach(() => {
        document.querySelectorAll('iframe').forEach((iframe) => iframe.remove())
        delete (window as any).Zone
        setUserAgent(originalUserAgent)
        jest.restoreAllMocks()
    })

    it.each([SAFARI_UA, CHROME_IOS_UA])('keeps the fallback iframe attached on WebKit', async (userAgent) => {
        setUserAgent(userAgent)

        expect(await getFreshNativeMutationObserver()).toBeDefined()

        const iframe = document.querySelector('iframe')
        expect(iframe).not.toBeNull()
        expect(iframe?.hidden).toBe(true)
        expect(iframe?.classList.contains('rr-block')).toBe(true)
        expect(iframe?.classList.contains('ph-no-capture')).toBe(true)
    })

    it('removes the fallback iframe on Chromium', async () => {
        setUserAgent(CHROME_UA)

        expect(await getFreshNativeMutationObserver()).toBeDefined()

        expect(document.querySelector('iframe')).toBeNull()
    })

    it('falls back to the window implementation when iframe creation fails', async () => {
        jest.spyOn(document, 'createElement').mockImplementation(() => {
            throw new Error('blocked')
        })

        expect(await getFreshNativeMutationObserver()).toBeDefined()
    })
})
