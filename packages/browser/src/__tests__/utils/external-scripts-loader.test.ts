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

        it('does not add duplicate scripts', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)

            const scripts = document!.getElementsByTagName('script')
            expect(scripts.length).toBe(1)
            expect(scripts[0].src).toMatchInlineSnapshot(`"https://us-assets.i.posthog.com/static/recorder.js?v=1.0.0"`)

            scripts[0].dispatchEvent(new Event('load'))
            expect(callback).toHaveBeenCalledTimes(2)
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

        it('keeps the legacy toolbar cache-busting path by default', () => {
            jest.useFakeTimers()
            jest.setSystemTime(1726067100000)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            expect(document!.getElementsByTagName('script')[0].src).toBe(
                'https://us-assets.i.posthog.com/static/toolbar.js?v=1.0.0&t=1726067100000'
            )
        })

        it.each([
            [
                'uses versioned asset paths on the normal asset host when the preview flag is enabled as a boolean',
                'https://us.posthog.com',
                true,
                'https://us-assets.i.posthog.com/static/1.0.0/recorder.js',
            ],
            [
                'uses a configured asset host override for versioned asset paths',
                'https://us.posthog.com',
                'https://cdn-preview.example.com/',
                'https://cdn-preview.example.com/static/1.0.0/recorder.js',
            ],
            [
                'uses the custom asset host from endpointFor when the preview flag is enabled',
                'https://my-proxy.example.com',
                true,
                'https://my-proxy.example.com/static/1.0.0/recorder.js',
            ],
        ])('%s', (_, apiHost, previewFlag, expectedSrc) => {
            const posthog = {
                config: {
                    api_host: apiHost,
                    external_scripts_inject_target: 'body',
                    __preview_external_dependency_versioned_paths: previewFlag,
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
