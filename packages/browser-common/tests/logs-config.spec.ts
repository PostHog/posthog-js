import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { runInNewContext } from 'node:vm'
import type { resolveLogsConfig } from '../src/logs-config'

const logsConfigPath = new URL('../dist/logs-config.js', import.meta.url)
const logsConfigSource = readFileSync(logsConfigPath, 'utf8')
const require = createRequire(logsConfigPath)
const windowsNavigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
const windowsAttributes = { 'os.name': 'Windows', 'os.version': '10' }

// Isolate missing globals from the test runner, which needs globalThis itself.
function loadLogsConfig(globals: Record<string, unknown>): typeof resolveLogsConfig {
    const module = { exports: {} as { resolveLogsConfig: typeof resolveLogsConfig } }
    runInNewContext(logsConfigSource, { ...globals, module, exports: module.exports, require })
    return module.exports.resolveLogsConfig
}

describe('resolveLogsConfig resource defaults (built)', () => {
    it('uses window.navigator when globalThis is unavailable', () => {
        const resolve = loadLogsConfig({ globalThis: undefined, window: { navigator: windowsNavigator } })

        expect(resolve(undefined).resourceAttributes).toEqual(windowsAttributes)
    })

    it('prefers globalThis.navigator when both globals are available', () => {
        const resolve = loadLogsConfig({
            globalThis: { navigator: windowsNavigator },
            window: { navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } },
        })

        expect(resolve(undefined).resourceAttributes).toEqual(windowsAttributes)
    })

    it.each([undefined, {}])('resolves safely without browser globals (globalThis: %j)', (globalObject) => {
        const resolve = loadLogsConfig({ globalThis: globalObject })

        expect(resolve(undefined).resourceAttributes).toEqual({})
    })

    it.each(['globalThis', 'window'])('reads %s.navigator lazily without accessing it during import', (name) => {
        let userAgent = windowsNavigator.userAgent
        const navigator = vi.fn(() => ({ userAgent }))
        const browserGlobal = Object.defineProperty({}, 'navigator', { get: navigator })
        const resolve = loadLogsConfig({ globalThis: undefined, [name]: browserGlobal })

        expect(navigator).not.toHaveBeenCalled()
        expect(resolve(undefined).resourceAttributes).toEqual(windowsAttributes)
        userAgent = 'unknown'
        expect(resolve(undefined).resourceAttributes).toEqual({})
        expect(navigator).toHaveBeenCalledTimes(2)
    })

    it.each(['globalThis', 'window'])('keeps explicit resource attributes above %s defaults', (name) => {
        const resolve = loadLogsConfig({ globalThis: undefined, [name]: { navigator: windowsNavigator } })
        const resourceAttributes = { 'os.name': 'Custom OS', 'os.version': '42', 'custom.attribute': 'value' }

        expect(resolve({ resourceAttributes }).resourceAttributes).toEqual(resourceAttributes)
    })
})
