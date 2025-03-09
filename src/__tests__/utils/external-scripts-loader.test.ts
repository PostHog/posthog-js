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

        it('should insert the given script before the one already on the page', () => {
            document!.body.appendChild(document!.createElement('script'))
            assignableWindow.__PosthogExtensions__.loadExternalDependency(mockPostHog, 'recorder', callback)
            const scripts = document!.getElementsByTagName('script')
            const new_script = scripts[0]

            expect(scripts.length).toBe(2)
            expect(new_script.type).toBe('text/javascript')
            expect(new_script.src).toMatchInlineSnapshot(`"https://us-assets.i.posthog.com/static/recorder.js?v=1.0.0"`)
            const event = new Event('test')
            new_script.onload!(event)
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
            scripts[0].onload!(event)
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
