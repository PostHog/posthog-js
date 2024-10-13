import { PostHog } from '../../posthog-core'
import _LazyLoadedDeadClicksAutocapture from '../../entrypoints/dead-clicks-autocapture'
import { assignableWindow, document } from '../../utils/globals'

// need to fake the timer before jsdom inits
jest.useFakeTimers()
jest.setSystemTime(1000)

const triggerMouseEvent = function (node: Node, eventType: string) {
    node.dispatchEvent(
        new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
        })
    )
}

describe('LazyLoadedDeadClicksAutocapture', () => {
    let fakeInstance: PostHog
    let lazyLoadedDeadClicksAutocapture: _LazyLoadedDeadClicksAutocapture

    beforeEach(async () => {
        jest.setSystemTime(1000)

        assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
        assignableWindow.__PosthogExtensions__.loadExternalDependency = jest
            .fn()
            .mockImplementation(() => (_ph: PostHog, _name: string, cb: (err?: Error) => void) => {
                cb()
            })

        fakeInstance = {
            config: {
                capture_dead_clicks: true,
            },
            persistence: {
                props: {},
            },
            _send_request: jest.fn(),
        } as unknown as Partial<PostHog> as PostHog

        lazyLoadedDeadClicksAutocapture = new _LazyLoadedDeadClicksAutocapture(fakeInstance)
        lazyLoadedDeadClicksAutocapture.start(document)
    })

    describe('defaults', () => {
        it('starts without scroll time', () => {
            expect(lazyLoadedDeadClicksAutocapture['_lastScroll']).toBe(undefined)
        })

        it('starts without mutation', () => {
            expect(lazyLoadedDeadClicksAutocapture['_lastMutation']).toBe(undefined)
        })

        it('starts without clicks', () => {
            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(0)
        })

        it('stores clicks', () => {
            lazyLoadedDeadClicksAutocapture.start(document)
            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(1)
        })

        it('sets timer when detecting clicks', () => {
            expect(lazyLoadedDeadClicksAutocapture['_checkClickTimer']).toBe(undefined)

            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_checkClickTimer']).not.toBe(undefined)
        })
    })

    describe('click ignore', () => {
        it('ignores clicks on same node within one second', () => {
            jest.setSystemTime(1000)
            triggerMouseEvent(document.body, 'click')

            jest.setSystemTime(1999)
            triggerMouseEvent(document.body, 'click')

            jest.setSystemTime(2000)
            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(2)
        })

        it('ignores clicks on links which might open a new window', () => {
            const link = document.createElement('a')
            link.setAttribute('target', '_blank')

            triggerMouseEvent(link, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(0)
        })

        it('does not ignores clicks on links which open in self', () => {
            const link = document.createElement('a')
            link.setAttribute('target', '_self')
            document.body.append(link)

            triggerMouseEvent(link, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(1)
        })

        it('ignores clicks on html node', () => {
            const fakeHTML = document.createElement('html')
            document.body.append(fakeHTML)

            triggerMouseEvent(fakeHTML, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(0)
        })

        it('ignores clicks on non element nodes', () => {
            // TODO: should we detect dead clicks on text nodes?
            const nonElementNode = document.createTextNode('text')
            document.body.append(nonElementNode)

            triggerMouseEvent(nonElementNode, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(0)
        })
    })
})
