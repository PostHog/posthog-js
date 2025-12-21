import { RequestRouter } from '../../utils/request-router'
import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import '../../entrypoints/external-scripts-loader'

describe('external-scripts-loader', () => {
    describe('loadScript', () => {
        const mockPostHog: PostHog = {
            config: {
                api_host: 'https://us.posthog.com',
            },
            version: '1.0.0',
        } as PostHog
        mockPostHog.requestRouter = new RequestRouter(mockPostHog)

        const callback = jest.fn()
        beforeEach(() => {
            callback.mockClear()
            document!.getElementsByTagName('html')![0].innerHTML = ''
        })

        it('appends scripts to head to avoid SSR body hydration issues', () => {
            const existingBodyScript = document!.createElement('script')
            existingBodyScript.id = 'framework-bundle'
            document!.body.appendChild(existingBodyScript)

            const initialBodyFirstChild = document!.body.firstChild

            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)

            const bodyScripts = document!.querySelectorAll('body > script')
            expect(bodyScripts.length).toBe(1)
            expect(bodyScripts[0].id).toBe('framework-bundle')
            expect(document!.body.firstChild).toBe(initialBodyFirstChild)

            const headScripts = document!.querySelectorAll('head > script')
            expect(headScripts.length).toBe(1)
            expect(headScripts[0].src).toContain('recorder.js')

            const event = new Event('test')
            headScripts[0].onload!(event)
            expect(callback).toHaveBeenCalledWith(undefined, event)
        })

        it('should not add duplicate scripts when called multiple times with the same URL', () => {
            // First call to load the script
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)

            // Second call with the same script
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)

            const scripts = document!.getElementsByTagName('script')
            expect(scripts.length).toBe(1)
            expect(scripts[0].src).toMatchInlineSnapshot(`"https://us-assets.i.posthog.com/static/recorder.js?v=1.0.0"`)

            // Verify both callbacks are called when script loads
            const event = new Event('test')

            scripts[0].dispatchEvent(new Event('load'))

            // we replace the handler
            expect(callback).toHaveBeenCalledTimes(2)
            expect(callback).toHaveBeenCalledWith(undefined, event)
        })

        it("should add the script to the page when there aren't any preexisting scripts on the page", () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            const scripts = document!.getElementsByTagName('script')

            expect(scripts?.length).toBe(1)
            expect(scripts![0].type).toBe('text/javascript')
            expect(scripts![0].src).toMatchInlineSnapshot(
                `"https://us-assets.i.posthog.com/static/recorder.js?v=1.0.0"`
            )
        })

        it('should respond with an error if one happens', () => {
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            const scripts = document!.getElementsByTagName('script')
            const new_script = scripts[0]

            new_script.onerror!('uh-oh')
            expect(callback).toHaveBeenCalledWith('uh-oh')
        })

        it('should add a timestamp to the toolbar loader', () => {
            jest.useFakeTimers()
            jest.setSystemTime(1726067100000)
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            const scripts = document!.getElementsByTagName('script')
            const new_script = scripts[0]
            expect(new_script.src).toBe('https://us-assets.i.posthog.com/static/toolbar.js?v=1.0.0&t=1726067100000')
        })

        it('allows adding a nonce via the prepare_external_dependency_script config', () => {
            mockPostHog.config.prepare_external_dependency_script = (script) => {
                script.nonce = '123'
                return script
            }
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            const scripts = document!.getElementsByTagName('script')
            const new_script = scripts[0]
            expect(new_script.nonce).toBe('123')
        })

        it('does not load script if prepare_external_dependency_script returns null', () => {
            mockPostHog.config.prepare_external_dependency_script = () => null
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'toolbar', callback)
            const scripts = document!.getElementsByTagName('script')
            expect(scripts.length).toBe(0)
            expect(callback).toHaveBeenCalledWith('prepare_external_dependency_script returned null')
        })
    })
})
