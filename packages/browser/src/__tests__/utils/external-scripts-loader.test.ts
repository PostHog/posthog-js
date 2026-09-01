import { RequestRouter } from '../../utils/request-router'
import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import '../../entrypoints/external-scripts-loader'

describe('external-scripts-loader', () => {
    afterEach(() => {
        jest.useRealTimers()
        document!.getElementsByTagName('html')![0].innerHTML = ''
    })

    describe('loadScript', () => {
        const mockPostHog = {
            config: {
                api_host: 'https://us.posthog.com',
                external_scripts_inject_target: 'body',
            },
            version: '1.0.0',
        } as PostHog
        mockPostHog.requestRouter = new RequestRouter(mockPostHog)

        const callback = jest.fn()
        beforeEach(() => {
            callback.mockClear()
            mockPostHog.config.api_host = 'https://us.posthog.com'
            mockPostHog.config.strict_script_versioning = false
            mockPostHog.config.asset_host = null
            delete mockPostHog.config.__preview_external_dependency_versioned_paths
        })

        it('appends scripts to body by default', () => {
            const existingBodyScript = document!.createElement('script')
            existingBodyScript.id = 'framework-bundle'
            document!.body.appendChild(existingBodyScript)

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)

            const bodyScripts = document!.querySelectorAll('body > script')
            expect(bodyScripts.length).toBe(2)
            expect(bodyScripts[0].src).toContain('recorder.js')
            expect(bodyScripts[1].id).toBe('framework-bundle')

            expect(document!.querySelectorAll('head > script').length).toBe(0)
        })

        it('appends scripts to head when configured', () => {
            mockPostHog.config.external_scripts_inject_target = 'head'

            const existingBodyScript = document!.createElement('script')
            existingBodyScript.id = 'framework-bundle'
            document!.body.appendChild(existingBodyScript)

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)

            const bodyScripts = document!.querySelectorAll('body > script')
            expect(bodyScripts.length).toBe(1)
            expect(bodyScripts[0].id).toBe('framework-bundle')

            const headScripts = document!.querySelectorAll('head > script')
            expect(headScripts.length).toBe(1)
            expect(headScripts[0].src).toContain('recorder.js')

            mockPostHog.config.external_scripts_inject_target = 'body'
        })

        it('does not add duplicate scripts when api_host is a relative path', () => {
            // a reverse-proxied host, which endpointFor returns as a relative URL
            mockPostHog.config.api_host = '/ingest'

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)

            const scripts = document!.getElementsByTagName('script')
            expect(scripts).toHaveLength(1)
            expect(scripts[0].src).toBe(`${document!.baseURI.replace(/\/$/, '')}/ingest/static/recorder.js?v=1.0.0`)

            scripts[0].dispatchEvent(new Event('load'))
            expect(callback).toHaveBeenCalledTimes(2)
        })

        it('does not add duplicate scripts', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)

            const scripts = document!.getElementsByTagName('script')
            expect(scripts.length).toBe(1)
            expect(scripts[0].src).toMatchInlineSnapshot(`"https://us-assets.i.posthog.com/static/recorder.js?v=1.0.0"`)

            scripts[0].dispatchEvent(new Event('load'))
            expect(callback).toHaveBeenCalledTimes(2)
        })

        it('does not add duplicate scripts when called before the document body exists', () => {
            const body = document!.body
            body.remove()
            const firstCallback = jest.fn()
            const secondCallback = jest.fn()

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', firstCallback)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', secondCallback)
            document!.documentElement.appendChild(body)
            document!.dispatchEvent(new Event('DOMContentLoaded'))

            const scripts = document!.getElementsByTagName('script')
            expect(scripts).toHaveLength(1)
            scripts[0].dispatchEvent(new Event('load'))
            expect(firstCallback).toHaveBeenCalledTimes(1)
            expect(secondCallback).toHaveBeenCalledTimes(1)
        })

        it('adds script when no preexisting scripts exist', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            const scripts = document!.getElementsByTagName('script')

            expect(scripts.length).toBe(1)
            expect(scripts[0].type).toBe('text/javascript')
            expect(scripts[0].src).toMatchInlineSnapshot(`"https://us-assets.i.posthog.com/static/recorder.js?v=1.0.0"`)
        })

        it('calls callback with error on failure', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            document!.getElementsByTagName('script')[0].onerror!('uh-oh')
            expect(callback).toHaveBeenCalledWith('uh-oh')
        })

        it('falls back to the legacy asset path when a versioned asset fails to load', () => {
            mockPostHog.config.strict_script_versioning = 'fallback'

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            let scripts = document!.getElementsByTagName('script')
            expect(scripts[0].src).toBe('https://us-assets.i.posthog.com/static/1.0.0/recorder.js')

            scripts[0].dispatchEvent(new Event('error'))
            scripts = document!.getElementsByTagName('script')
            expect(scripts).toHaveLength(1)
            expect(scripts[0].src).toBe('https://us-assets.i.posthog.com/static/recorder.js?v=1.0.0')
            expect(callback).not.toHaveBeenCalled()

            scripts[0].dispatchEvent(new Event('load'))
            expect(callback).toHaveBeenCalledWith(undefined, expect.any(Event))
        })

        it('returns the legacy asset error when both paths fail to load', () => {
            mockPostHog.config.strict_script_versioning = 'fallback'

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            document!.getElementsByTagName('script')[0].dispatchEvent(new Event('error'))
            document!.getElementsByTagName('script')[0].onerror!('legacy-error')

            expect(callback).toHaveBeenCalledWith('legacy-error')
        })

        it('coalesces concurrent callers across the fallback attempt', () => {
            mockPostHog.config.strict_script_versioning = 'fallback'
            const firstCallback = jest.fn()
            const secondCallback = jest.fn()
            const lateCallback = jest.fn()

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', firstCallback)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', secondCallback)
            document!.getElementsByTagName('script')[0].dispatchEvent(new Event('error'))
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', lateCallback)

            const scripts = document!.getElementsByTagName('script')
            expect(scripts).toHaveLength(1)
            expect(scripts[0].src).toBe('https://us-assets.i.posthog.com/static/recorder.js?v=1.0.0')
            scripts[0].dispatchEvent(new Event('load'))

            for (const loadCallback of [firstCallback, secondCallback, lateCallback]) {
                expect(loadCallback).toHaveBeenCalledTimes(1)
                expect(loadCallback).toHaveBeenCalledWith(undefined, expect.any(Event))
            }
        })

        it('shares the terminal fallback error with concurrent and later callers', () => {
            mockPostHog.config.strict_script_versioning = 'fallback'
            const firstCallback = jest.fn()
            const secondCallback = jest.fn()
            const lateCallback = jest.fn()

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', firstCallback)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', secondCallback)
            document!.getElementsByTagName('script')[0].dispatchEvent(new Event('error'))

            const fallbackScript = document!.getElementsByTagName('script')[0]
            fallbackScript.dispatchEvent(new Event('error'))
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', lateCallback)

            expect(document!.getElementsByTagName('script')).toHaveLength(1)
            for (const loadCallback of [firstCallback, secondCallback, lateCallback]) {
                expect(loadCallback).toHaveBeenCalledTimes(1)
                expect(loadCallback).toHaveBeenCalledWith(expect.any(Event))
            }
        })

        it('does not fall back when strict versioning is enabled', () => {
            mockPostHog.config.strict_script_versioning = true

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            document!.getElementsByTagName('script')[0].dispatchEvent(new Event('error'))

            expect(document!.getElementsByTagName('script')).toHaveLength(1)
            expect(callback).toHaveBeenCalledWith(expect.any(Event))
        })

        it('does not fall back after a versioned asset loads successfully', () => {
            mockPostHog.config.strict_script_versioning = 'fallback'

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            document!.getElementsByTagName('script')[0].dispatchEvent(new Event('load'))

            expect(document!.getElementsByTagName('script')).toHaveLength(1)
            expect(callback).toHaveBeenCalledWith(undefined, expect.any(Event))
        })

        it('keeps the legacy toolbar cache-busting path by default', () => {
            jest.useFakeTimers()
            jest.setSystemTime(1726067100000)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            expect(document!.getElementsByTagName('script')[0].src).toBe(
                'https://us-assets.i.posthog.com/static/toolbar.js?v=1.0.0&t=1726067100000'
            )
        })

        it('cache-busts the legacy toolbar path when falling back', () => {
            jest.useFakeTimers()
            jest.setSystemTime(1726067100000)
            mockPostHog.config.strict_script_versioning = 'fallback'

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            document!.getElementsByTagName('script')[0].dispatchEvent(new Event('error'))

            expect(document!.getElementsByTagName('script')[0].src).toBe(
                'https://us-assets.i.posthog.com/static/toolbar.js?v=1.0.0&t=1726067100000'
            )
        })

        it.each([
            [
                'uses versioned asset paths on the normal asset host when strict_script_versioning is enabled',
                'https://us.posthog.com',
                { strict_script_versioning: true },
                'https://us-assets.i.posthog.com/static/1.0.0/recorder.js',
            ],
            [
                'uses a configured asset_host override for versioned asset paths',
                'https://us.posthog.com',
                { strict_script_versioning: true, asset_host: 'https://cdn-preview.example.com/' },
                'https://cdn-preview.example.com/static/1.0.0/recorder.js',
            ],
            [
                'uses a configured asset_host override for legacy asset paths',
                'https://us.posthog.com',
                { asset_host: 'https://cdn-preview.example.com/' },
                'https://cdn-preview.example.com/static/recorder.js?v=1.0.0',
            ],
            [
                'uses the custom asset host from endpointFor when strict_script_versioning is enabled',
                'https://my-proxy.example.com',
                { strict_script_versioning: true },
                'https://my-proxy.example.com/static/1.0.0/recorder.js',
            ],
        ])('%s', (_, apiHost, configOverrides, expectedSrc) => {
            const posthog = {
                config: {
                    api_host: apiHost,
                    external_scripts_inject_target: 'body',
                    ...configOverrides,
                },
                version: '1.0.0',
            } as PostHog
            posthog.requestRouter = new RequestRouter(posthog)

            assignableWindow.__PosthogExtensions__.loadExternalDependency(posthog, 'recorder', callback)

            expect(document!.getElementsByTagName('script')[0].src).toBe(expectedSrc)
        })

        it('uses eu-assets on the EU region', () => {
            const euPostHog = {
                config: {
                    api_host: 'https://eu.i.posthog.com',
                    external_scripts_inject_target: 'body',
                },
                version: '1.0.0',
            } as PostHog
            euPostHog.requestRouter = new RequestRouter(euPostHog)

            assignableWindow.__PosthogExtensions__.loadExternalDependency(euPostHog, 'recorder', callback)

            expect(document!.getElementsByTagName('script')[0].src).toBe(
                'https://eu-assets.i.posthog.com/static/recorder.js?v=1.0.0'
            )
        })

        it('allows adding nonce via prepare_external_dependency_script', () => {
            mockPostHog.config.prepare_external_dependency_script = (script) => {
                script.nonce = '123'
                return script
            }

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            expect(document!.getElementsByTagName('script')[0].nonce).toBe('123')

            delete mockPostHog.config.prepare_external_dependency_script
        })

        it('does not load script if prepare_external_dependency_script returns null', () => {
            mockPostHog.config.prepare_external_dependency_script = () => null

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            expect(document!.getElementsByTagName('script').length).toBe(0)
            expect(callback).toHaveBeenCalledWith('prepare_external_dependency_script returned null')

            delete mockPostHog.config.prepare_external_dependency_script
        })
    })

    describe('remote-config loading', () => {
        const posthog = {
            config: {
                api_host: 'https://us.posthog.com',
                token: 'test-token',
                external_scripts_inject_target: 'body',
            },
            version: '1.0.0',
        } as PostHog
        posthog.requestRouter = new RequestRouter(posthog)

        const callback = jest.fn()
        beforeEach(() => {
            callback.mockClear()
        })

        it('loads remote-config from the token-specific path', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency(posthog, 'remote-config', callback)

            const scripts = document!.getElementsByTagName('script')
            expect(scripts.length).toBe(1)
            expect(scripts[0].src).toBe('https://us-assets.i.posthog.com/array/test-token/config.js')
        })
    })
})
