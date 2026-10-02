// @vitest-environment jsdom
import { Autocapture } from '../src/autocapture'
import type { AutocaptureConfig, AutocaptureConfigSource } from '../src/autocapture-config'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../src/constants'
import { createTestClient } from './helpers/test-client'

const extensions: Autocapture[] = []
const create = (overrides: Partial<AutocaptureConfig> = {}) => {
    const config: AutocaptureConfig = {
        enabled: true,
        rageclick: false,
        maskAllElementAttributes: false,
        maskAllText: false,
        disableCaptureUrlHashes: false,
        remoteRequestsDisabled: false,
        ...overrides,
    }
    const extension = new Autocapture({ refresh: (target) => Object.assign(target, config) })
    extensions.push(extension)
    return { extension, config }
}
const click = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))

beforeEach(() => {
    document.body.innerHTML = '<button id="action">Buy now</button>'
})
afterEach(() => {
    for (const extension of extensions.splice(0)) extension.dispose()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe('shared autocapture', () => {
    it('waits for remote enablement, preserves selector properties and stops on disposal', () => {
        const client = createTestClient()
        const { extension } = create()
        extension.setup(client)
        const button = document.querySelector('button')!
        extension.setElementSelectors(new Set(['#action']))
        click(button)
        expect(client.capturedEvents).toHaveLength(0)
        client.setRemoteConfig({ autocapture_opt_out: false, elementsChainAsString: true })
        click(button)
        expect(client.capturedEvents).toHaveLength(1)
        expect(client.capturedEvents[0]?.properties).toMatchObject({
            $event_type: 'click',
            $ce_version: 1,
            $el_text: 'Buy now',
            $element_selectors: ['#action'],
        })
        expect(client.capturedEvents[0]?.properties.$elements_chain).toContain('button')
        extension.dispose()
        click(button)
        expect(client.capturedEvents).toHaveLength(1)
    })

    it('retains persisted opt-out after a failed remote request', () => {
        const client = createTestClient()
        client.kv.set(AUTOCAPTURE_DISABLED_SERVER_SIDE, true)
        const { extension } = create()
        extension.setup(client)
        client.setRemoteConfigResult({ ok: false, error: new Error('offline') })
        expect(extension.isEnabled).toBe(false)
        expect(client.kv.get(AUTOCAPTURE_DISABLED_SERVER_SIDE)).toBe(true)
        click(document.querySelector('button')!)
        expect(client.capturedEvents).toHaveLength(0)
    })

    it('refreshes client configuration and preserves redaction and no-capture checks', () => {
        const client = createTestClient()
        const { extension, config } = create({ remoteRequestsDisabled: true, maskAllText: true })
        extension.setup(client)
        const button = document.querySelector('button')!
        click(button)
        expect(client.capturedEvents[0]?.properties).not.toHaveProperty('$el_text')
        button.className = 'ph-no-capture'
        click(button)
        expect(client.capturedEvents).toHaveLength(1)
        button.className = ''
        config.enabled = false
        click(button)
        expect(client.capturedEvents).toHaveLength(1)
    })

    it('removes handlers from the same targets even after browser globals are replaced', () => {
        const client = createTestClient()
        const { extension } = create({ remoteRequestsDisabled: true, capture_copied_text: true })
        extension.setup(client)
        const originalDocument = document
        const originalWindow = window
        const documentRemove = vi.spyOn(originalDocument, 'removeEventListener')
        const windowRemove = vi.spyOn(originalWindow, 'removeEventListener')
        vi.stubGlobal('document', originalDocument.implementation.createHTMLDocument())
        vi.stubGlobal('window', undefined)
        extension.dispose()
        extension.dispose()
        expect(documentRemove.mock.calls.filter(([event]) => event === 'click')).toHaveLength(1)
        expect(documentRemove).toHaveBeenCalledWith('copy', expect.any(Function), true)
        expect(windowRemove.mock.calls.filter(([event]) => event === 'blur')).toHaveLength(1)
    })

    it('can clean up listeners after partial attachment fails', () => {
        const client = createTestClient()
        const { extension } = create({ remoteRequestsDisabled: true })
        const originalAdd = document.addEventListener.bind(document)
        vi.spyOn(document, 'addEventListener').mockImplementation((type, callback, options) => {
            if (type === 'change') throw new Error('listener failed')
            originalAdd(type, callback, options)
        })
        const remove = vi.spyOn(document, 'removeEventListener')
        expect(() => extension.setup(client)).toThrow('listener failed')
        extension.dispose()
        expect(remove).toHaveBeenCalledWith('submit', expect.any(Function), true)
    })

    it('constructs with one SDK-neutral internal config', () => {
        const configSource: AutocaptureConfigSource = {
            refresh: (config) => {
                config.enabled = true
                config.rageclick = false
                config.maskAllElementAttributes = false
                config.maskAllText = false
                config.disableCaptureUrlHashes = false
                config.remoteRequestsDisabled = true
            },
        }
        const extension = new Autocapture(configSource)
        extensions.push(extension)
        extension.setup(createTestClient())

        expect(extension).not.toHaveProperty('_settings')
        expect(extension['_config']).toEqual({
            enabled: true,
            rageclick: false,
            maskAllElementAttributes: false,
            maskAllText: false,
            disableCaptureUrlHashes: false,
            remoteRequestsDisabled: true,
            url_allowlist: undefined,
            url_ignorelist: undefined,
        })
    })

    it('releases remote config and DOM listeners on dispose', () => {
        const client = createTestClient()
        const initialize = vi.spyOn(client.kv, 'initialize')
        const onRemoteConfig = vi.spyOn(client, 'onRemoteConfig')
        const { extension } = create({ remoteRequestsDisabled: true, capture_copied_text: true })
        const captureEvent = vi.spyOn(extension as any, '_captureEvent')

        extension.setup(client)
        const remoteConfigHandler = onRemoteConfig.mock.calls[0][0]
        const remoteConfigDispose = vi.spyOn(onRemoteConfig.mock.results[0].value, 'dispose')
        expect(extension['_initialized']).toBe(true)
        extension.dispose()
        extension.dispose()

        remoteConfigHandler?.({ ok: true, config: { autocapture_opt_out: false } })
        click(document.querySelector('button')!)
        document.dispatchEvent(new Event('copy', { bubbles: true }))

        expect(initialize).not.toHaveBeenCalled()
        expect(remoteConfigDispose).toHaveBeenCalledTimes(1)
        expect(extension['_hasReceivedConfigResponse']).toBe(false)
        expect(extension['_initialized']).toBe(false)
        expect(captureEvent).not.toHaveBeenCalled()
        expect(client.capturedEvents).toHaveLength(0)
    })

    describe('remote config DOM listener initialization', () => {
        let extension: Autocapture
        let config: AutocaptureConfig

        beforeEach(() => {
            ;({ extension, config } = create())
            extension.setup(createTestClient())
            vi.spyOn(extension, '_addDomEventHandlers')
        })

        it('should call _addDomEventHandlers if autocapture is enabled in client config', () => {
            config.enabled = true
            extension.onRemoteConfig({ ok: true, config: { autocapture_opt_out: false } })
            expect(extension['_addDomEventHandlers']).toHaveBeenCalled()
        })

        it('should not call _addDomEventHandlers if autocapture is opted out in server config', () => {
            extension.onRemoteConfig({ ok: true, config: { autocapture_opt_out: true } })
            expect(extension['_addDomEventHandlers']).not.toHaveBeenCalled()
        })

        it('should not call _addDomEventHandlers if autocapture is disabled in client config', () => {
            expect(extension['_addDomEventHandlers']).not.toHaveBeenCalled()
            config.enabled = false

            extension.onRemoteConfig({ ok: true, config: { autocapture_opt_out: false } })

            expect(extension['_addDomEventHandlers']).not.toHaveBeenCalled()
        })

        it('should NOT call _addDomEventHandlers when the extension has already been initialized', () => {
            extension.onRemoteConfig({ ok: true, config: { autocapture_opt_out: false } })
            expect(extension['_addDomEventHandlers']).toHaveBeenCalledTimes(1)

            extension.onRemoteConfig({ ok: true, config: { autocapture_opt_out: false } })
            expect(extension['_addDomEventHandlers']).toHaveBeenCalledTimes(1)
        })
    })
})
