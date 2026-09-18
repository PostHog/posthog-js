/// <reference lib="dom" />
import { Autocapture, getDefaultProperties } from '../autocapture'
import { FlagsResponse } from '../types'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../constants'
import { PostHog } from '../posthog-core'
import { BrowserAutocapture } from '../browser-autocapture'
import {
    Autocapture as SharedAutocapture,
    getDefaultProperties as sharedDefaultProperties,
} from '@posthog/browser-common/autocapture'
import { AutocaptureExtension } from '../extension-tokens'
import { window } from '@posthog/browser-common/utils/globals'
import { createPosthogInstance } from './helpers/posthog-instance'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { isUndefined } from '@posthog/core'

const simulateClick = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('Autocapture system', () => {
    const originalWindowLocation = window!.location

    let autocapture: Autocapture
    let posthog: PostHog

    beforeEach(async () => {
        vi.spyOn(window!.console, 'log').mockImplementation(() => {})

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            writable: true,

            value: new URL('https://example.com'),
        })

        posthog = await createPosthogInstance(uuidv7(), {
            api_host: 'https://test.com',
            token: 'testtoken',
            autocapture: true,
        })

        if (isUndefined(posthog.autocapture)) {
            throw new Error('helping TS by confirming this is created by now')
        }
        autocapture = posthog.autocapture
    })

    afterEach(async () => {
        await posthog.shutdown()
        vi.restoreAllMocks()
        document.getElementsByTagName('html')[0].innerHTML = ''

        Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            value: originalWindowLocation,
        })
    })

    describe('extension lifecycle', () => {
        it('retains the legacy wrapper and token while sharing the implementation and helpers', () => {
            expect(Autocapture).toBe(SharedAutocapture)
            expect(autocapture).toBeInstanceOf(BrowserAutocapture)
            expect(autocapture).toBeInstanceOf(Autocapture)
            expect(autocapture).toBeInstanceOf(SharedAutocapture)
            expect(autocapture.name).toBe(AutocaptureExtension)
            expect(getDefaultProperties).toBe(sharedDefaultProperties)
        })

        it('adapts browser config into its stable internal config', () => {
            const extension = new BrowserAutocapture(posthog)
            const config = extension['_config']

            expect(extension.instance).toBe(posthog)

            void extension.isEnabled

            expect(extension['_config']).toBe(config)
            expect(config).toMatchObject({
                enabled: !!posthog.config.autocapture,
                rageclick: posthog.config.rageclick,
                maskAllElementAttributes: posthog.config.mask_all_element_attributes,
                maskAllText: posthog.config.mask_all_text,
                disableCaptureUrlHashes: posthog.config.disable_capture_url_hashes,
                getCurrentUrl: posthog.config.get_current_url,
                remoteRequestsDisabled: posthog._shouldDisableFlags(),
            })
            expect(config).not.toBe(posthog.config)
        })

        it('compiles URL patterns without mutating the browser config', () => {
            const urlAllowlist = ['https://example.com/.*']
            posthog.config.autocapture = { url_allowlist: urlAllowlist }
            const extension = new BrowserAutocapture(posthog)

            const config = extension['_compileUrlPatterns']()

            expect(config.url_allowlist).toEqual([new RegExp('https://example.com/.*')])
            expect(posthog.config.autocapture.url_allowlist).toBe(urlAllowlist)
        })

        it.each([
            ['allowlist', { url_allowlist: ['https://example.com/.*', '['] }],
            ['ignorelist', { url_ignorelist: ['https://posthog.com/.*', '('] }],
        ])('fails autocapture initialization for an invalid URL %s', async (_, autocaptureConfig) => {
            const instance = await createPosthogInstance(uuidv7(), {
                autocapture: autocaptureConfig,
                capture_pageview: false,
            })
            const capture = vi.spyOn(instance, 'capture')
            const button = document.createElement('button')
            document.body.appendChild(button)

            simulateClick(button)

            expect(instance.autocapture?.isEnabled).toBe(false)
            expect(capture).not.toHaveBeenCalled()
            await instance.shutdown()
        })

        it('receives set_config updates through its compatibility config source', () => {
            autocapture.onRemoteConfig({ ok: true, config: { autocapture_opt_out: false } as FlagsResponse })

            posthog.set_config({ autocapture: false })

            expect(autocapture.isEnabled).toBe(false)
        })

        it('receives each remote config result once', async () => {
            const onRemoteConfig = vi.spyOn(Autocapture.prototype, 'onRemoteConfig')
            const instance = await createPosthogInstance(uuidv7(), { capture_pageview: false })
            onRemoteConfig.mockClear()
            const result = { ok: true, config: { autocapture_opt_out: false } as FlagsResponse } as const

            instance._onRemoteConfig(result)

            expect(onRemoteConfig).toHaveBeenCalledTimes(1)
            expect(onRemoteConfig).toHaveBeenCalledWith(result)
            await instance.shutdown()
            onRemoteConfig.mockRestore()
        })

        it('stops receiving remote config after shutdown', async () => {
            const onRemoteConfig = vi.spyOn(Autocapture.prototype, 'onRemoteConfig')
            const instance = await createPosthogInstance(uuidv7(), { capture_pageview: false })
            await instance.shutdown()
            onRemoteConfig.mockClear()

            instance._onRemoteConfig({ ok: false })

            expect(onRemoteConfig).not.toHaveBeenCalled()
            onRemoteConfig.mockRestore()
        })
    })

    describe('afterFlagsResponse()', () => {
        beforeEach(() => {
            document.title = 'test page'
        })

        it('should be enabled after init when autocapture is true in config', () => {
            expect(autocapture.isEnabled).toBe(true)
        })

        it('should be enabled before the flags response if flags is disabled', () => {
            posthog.config.advanced_disable_flags = true
            expect(autocapture.isEnabled).toBe(true)
        })

        it('should be disabled when remote config has autocapture_opt_out', () => {
            autocapture.onRemoteConfig({ ok: true, config: { autocapture_opt_out: true } as FlagsResponse })
            expect(autocapture.isEnabled).toBe(false)
        })

        it('should be disabled before the flags response if client side opted out', () => {
            posthog.config.autocapture = false
            expect(autocapture.isEnabled).toBe(false)
        })

        describe('when the remote config fetch fails', () => {
            beforeEach(() => {
                autocapture['_isDisabledServerSide'] = null
                autocapture['_hasReceivedConfigResponse'] = false
                posthog.persistence!.unregister(AUTOCAPTURE_DISABLED_SERVER_SIDE)
            })

            it('stays disabled when there has never been a successful config response', () => {
                autocapture.onRemoteConfig({ ok: false })
                expect(autocapture.isEnabled).toBe(false)
                expect(posthog.persistence!.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]).toBeUndefined()
            })

            it('keeps a persisted server-side opt-out', () => {
                posthog.persistence!.register({ [AUTOCAPTURE_DISABLED_SERVER_SIDE]: true })
                autocapture.onRemoteConfig({ ok: false })
                expect(autocapture.isEnabled).toBe(false)
                expect(posthog.persistence!.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]).toBe(true)
            })

            it('keeps a persisted enabled state', () => {
                posthog.persistence!.register({ [AUTOCAPTURE_DISABLED_SERVER_SIDE]: false })
                autocapture.onRemoteConfig({ ok: false })
                expect(autocapture.isEnabled).toBe(true)
            })

            it('stays disabled when flags are disabled after the failure', () => {
                autocapture.onRemoteConfig({ ok: false })
                posthog.config.advanced_disable_flags = true
                expect(autocapture.isEnabled).toBe(false)
            })
        })

        describe('when the remote config response is missing autocapture_opt_out', () => {
            beforeEach(() => {
                autocapture['_isDisabledServerSide'] = null
                autocapture['_hasReceivedConfigResponse'] = false
                posthog.persistence!.unregister(AUTOCAPTURE_DISABLED_SERVER_SIDE)
            })

            it('stays disabled when there has never been a config response with the field', () => {
                autocapture.onRemoteConfig({ ok: true, config: {} as FlagsResponse })
                expect(autocapture.isEnabled).toBe(false)
                expect(posthog.persistence!.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]).toBeUndefined()
            })

            it('keeps a persisted server-side opt-out', () => {
                posthog.persistence!.register({ [AUTOCAPTURE_DISABLED_SERVER_SIDE]: true })
                autocapture.onRemoteConfig({ ok: true, config: {} as FlagsResponse })
                expect(autocapture.isEnabled).toBe(false)
                expect(posthog.persistence!.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]).toBe(true)
            })

            it('keeps a persisted enabled state', () => {
                posthog.persistence!.register({ [AUTOCAPTURE_DISABLED_SERVER_SIDE]: false })
                autocapture.onRemoteConfig({ ok: true, config: {} as FlagsResponse })
                expect(autocapture.isEnabled).toBe(true)
                expect(posthog.persistence!.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]).toBe(false)
            })

            it('ignores a non-boolean value', () => {
                autocapture.onRemoteConfig({
                    ok: true,
                    config: { autocapture_opt_out: 'yes' } as unknown as FlagsResponse,
                })
                expect(autocapture.isEnabled).toBe(false)
                expect(posthog.persistence!.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]).toBeUndefined()
            })

            it('keeps the in-memory value when persistence has no entry', () => {
                autocapture['_isDisabledServerSide'] = true
                autocapture.onRemoteConfig({ ok: true, config: {} as FlagsResponse })
                expect(autocapture.isEnabled).toBe(false)
            })

            it('recovers once a response includes the field', () => {
                autocapture.onRemoteConfig({ ok: true, config: {} as FlagsResponse })
                expect(autocapture.isEnabled).toBe(false)

                autocapture.onRemoteConfig({ ok: true, config: { autocapture_opt_out: false } as FlagsResponse })
                expect(autocapture.isEnabled).toBe(true)
                expect(posthog.persistence!.props[AUTOCAPTURE_DISABLED_SERVER_SIDE]).toBe(false)
            })

            it('stays disabled when flags are disabled after the response', () => {
                autocapture.onRemoteConfig({ ok: true, config: {} as FlagsResponse })
                posthog.config.advanced_disable_flags = true
                expect(autocapture.isEnabled).toBe(false)
            })

            it('is enabled when flags were disabled and no config outcome ever arrived', () => {
                posthog.set_config({ advanced_disable_flags: true })
                expect(autocapture.isEnabled).toBe(true)
            })
        })

        it.each([
            // when client side is opted out, it is always off
            [false, true, false],
            [false, false, false],
            // when client side is opted in, it is only on, if the remote does not opt out
            [true, true, false],
            [true, false, true],
        ])(
            'when client side config is %p and remote opt out is %p - autocapture enabled should be %p',
            (clientSideOptIn, serverSideOptOut, expected) => {
                posthog.config.autocapture = clientSideOptIn
                autocapture.onRemoteConfig({
                    ok: true,
                    config: {
                        autocapture_opt_out: serverSideOptOut,
                    } as FlagsResponse,
                })
                expect(autocapture.isEnabled).toBe(expected)
            }
        )
    })
})
