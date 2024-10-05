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
            expect(new_script.src).toMatchInlineSnapshot(
                `"https://us-assets.i.posthog.com/static/toolbar.js?v=1.0.0?&=1726067100000"`
            )
        })
    })
})
