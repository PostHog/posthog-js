/* eslint-disable compat/compat */
/**
 * Guards the snippet files against accidental growth: the classic snippet is
 * pasted inline into millions of pages, so every byte ships with every page
 * view; the opt-in unload fallback is shared with particular customers and
 * should stay small enough to paste comfortably.
 */
import * as fs from 'fs'
import * as path from 'path'
import { gzipSync, strToU8 } from 'fflate'
import { minify } from 'terser'

const read = (file: string) => fs.readFileSync(path.join(__dirname, '../../snippet', file), 'utf8')

const minified = async (source: string): Promise<string> => {
    const result = await minify(source, { ecma: 5, mangle: true, compress: { passes: 2 } })
    if (!result.code) {
        throw new Error('terser produced no output')
    }
    return result.code
}

const gzippedSize = (code: string) => gzipSync(strToU8(code)).byteLength

describe('snippet size', () => {
    it.each([
        ['snippet.js', 1000, 600],
        ['unload-fallback.js', 3300, 1600],
    ])('%s stays within its byte budget when minified', async (file, minifiedBudget, gzippedBudget) => {
        const code = await minified(read(file))

        expect(code.length).toBeLessThan(minifiedBudget)
        expect(gzippedSize(code)).toBeLessThan(gzippedBudget)
    })

    it('still beacons queued captures on pagehide after minification', async () => {
        ;(window as any).posthog = undefined
        localStorage.clear()
        const sendBeaconMock = jest.fn(() => true)
        Object.defineProperty(window.navigator, 'sendBeacon', {
            value: sendBeaconMock,
            configurable: true,
            writable: true,
        })

        new Function(await minified(read('snippet.js')))()
        new Function(await minified(read('unload-fallback.js')))()
        const posthog = (window as any).posthog
        posthog.init('minified_token', { api_host: 'https://app.example.com' })
        posthog.capture('minified-event')

        window.dispatchEvent(new Event('onpagehide' in window ? 'pagehide' : 'unload'))

        expect(sendBeaconMock).toHaveBeenCalledTimes(1)
        expect(sendBeaconMock.mock.calls[0][0]).toBe('https://app.example.com/e/?compression=base64')
    })
})
