import { RequestRouter } from '../../utils/request-router'
import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import '../../entrypoints/external-scripts-loader'

describe('external-scripts-loader', () => {
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
            document!.getElementsByTagName('html')![0].innerHTML = ''
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

        it('adds timestamp to toolbar loader', () => {
            jest.useFakeTimers()
            jest.setSystemTime(1726067100000)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            expect(document!.getElementsByTagName('script')[0].src).toBe(
                'https://us-assets.i.posthog.com/static/toolbar.js?v=1.0.0&t=1726067100000'
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
})
