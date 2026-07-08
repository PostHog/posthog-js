/* eslint-disable compat/compat */
/**
 * Guards the snippet against accidental growth: it is pasted inline into
 * millions of pages, so every byte ships with every page view.
 */
import * as fs from 'fs'
import * as path from 'path'
import { gzipSync, strToU8 } from 'fflate'
import { minify } from 'terser'

const snippetSource = fs.readFileSync(path.join(__dirname, '../../snippet/snippet.js'), 'utf8')

const MINIFIED_BUDGET_BYTES = 3400
const GZIPPED_BUDGET_BYTES = 1700

const minifiedSnippet = async (): Promise<string> => {
    const result = await minify(snippetSource, { ecma: 5, mangle: true, compress: { passes: 2 } })
    if (!result.code) {
        throw new Error('terser produced no output for the snippet')
    }
    return result.code
}

describe('snippet size', () => {
    it('stays within its byte budget when minified', async () => {
        const code = await minifiedSnippet()
        const gzipped = gzipSync(strToU8(code)).byteLength

        expect(code.length).toBeLessThan(MINIFIED_BUDGET_BYTES)
        expect(gzipped).toBeLessThan(GZIPPED_BUDGET_BYTES)
    })

    it('still beacons queued captures on pagehide after minification', async () => {
        const code = await minifiedSnippet()

        ;(window as any).posthog = undefined
        localStorage.clear()
        const sendBeaconMock = jest.fn(() => true)
        Object.defineProperty(window.navigator, 'sendBeacon', {
            value: sendBeaconMock,
            configurable: true,
            writable: true,
        })

        new Function(code)()
        const posthog = (window as any).posthog
        posthog.init('minified_token', { api_host: 'https://app.example.com' })
        posthog.capture('minified-event')

        window.dispatchEvent(new Event('onpagehide' in window ? 'pagehide' : 'unload'))

        expect(sendBeaconMock).toHaveBeenCalledTimes(1)
        expect(sendBeaconMock.mock.calls[0][0]).toBe('https://app.example.com/e/?compression=base64')
    })
})
