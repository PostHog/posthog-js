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
            capture: jest.fn(),
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

    it('tracks last scroll', () => {
        expect(lazyLoadedDeadClicksAutocapture['_lastScroll']).not.toBeDefined()

        triggerMouseEvent(document.body, 'scroll')

        expect(lazyLoadedDeadClicksAutocapture['_lastScroll']).toBeDefined()
    })

    // i think there's some kind of jsdom fangling happening where the mutation observer
    // started by the detector isn't passed details of mutations made in the tests
    // js-dom supports mutation observer since v13.x but 🤷
    it.skip('tracks last mutation', () => {
        expect(lazyLoadedDeadClicksAutocapture['_lastMutation']).not.toBeDefined()

        document.body.append(document.createElement('div'))

        expect(lazyLoadedDeadClicksAutocapture['_lastMutation']).toBeDefined()
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

    describe('dead click detection', () => {
        beforeEach(() => {
            jest.setSystemTime(0)
        })

        it('click followed by scroll, not a dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({ node: document.body, timestamp: 900 })
            lazyLoadedDeadClicksAutocapture['_lastScroll'] = 999
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click followed by mutation, not a dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({ node: document.body, timestamp: 900 })
            lazyLoadedDeadClicksAutocapture['_lastScroll'] = undefined
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = 1000

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click followed by a mutation after threshold, dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({ node: document.body, timestamp: 900 })
            lazyLoadedDeadClicksAutocapture['_lastScroll'] = undefined
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = 900 + 2501

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith('$dead_click', {
                // faked system timestamp isn't moving so this is negative
                $dead_click_absolute_delay_ms: -900,
                $dead_click_absolute_timeout: false,
                $dead_click_event_timestamp: 900,
                $dead_click_last_mutation_timestamp: 3401,
                $dead_click_last_scroll_timestamp: undefined,
                $dead_click_mutation_delay_ms: 2501,
                $dead_click_mutation_timeout: true,
                $dead_click_scroll_delay_ms: undefined,
                $dead_click_scroll_timeout: false,
                nth_child: 2,
                nth_of_type: 1,
                tag_name: 'body',
                timestamp: 900,
            })
        })

        it('click followed by a scroll after threshold, dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({ node: document.body, timestamp: 900 })
            lazyLoadedDeadClicksAutocapture['_lastScroll'] = 900 + 2051
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith('$dead_click', {
                // faked system timestamp isn't moving so this is negative
                $dead_click_absolute_delay_ms: -900,
                $dead_click_absolute_timeout: false,
                $dead_click_event_timestamp: 900,
                $dead_click_last_mutation_timestamp: undefined,
                $dead_click_last_scroll_timestamp: 2951,
                $dead_click_mutation_delay_ms: undefined,
                $dead_click_mutation_timeout: false,
                $dead_click_scroll_delay_ms: 2051,
                $dead_click_scroll_timeout: true,
                nth_child: 2,
                nth_of_type: 1,
                tag_name: 'body',
                timestamp: 900,
            })
        })

        it('click followed by nothing for too long, dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({ node: document.body, timestamp: 900 })
            lazyLoadedDeadClicksAutocapture['_lastScroll'] = undefined
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            jest.setSystemTime(2501 + 900)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith('$dead_click', {
                $dead_click_absolute_delay_ms: 2501,
                $dead_click_absolute_timeout: true,
                $dead_click_event_timestamp: 900,
                $dead_click_last_mutation_timestamp: undefined,
                $dead_click_last_scroll_timestamp: undefined,
                $dead_click_mutation_delay_ms: undefined,
                $dead_click_mutation_timeout: false,
                $dead_click_scroll_delay_ms: undefined,
                $dead_click_scroll_timeout: false,
                nth_child: 2,
                nth_of_type: 1,
                tag_name: 'body',
                timestamp: 900,
            })
        })

        it('click not followed by anything within threshold, rescheduled for next check', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({ node: document.body, timestamp: 900 })
            lazyLoadedDeadClicksAutocapture['_lastScroll'] = undefined
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            jest.setSystemTime(25 + 900)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })
    })
})