import { PostHog } from '../../posthog-core'
import LazyLoadedDeadClicksAutocapture from '../../entrypoints/dead-clicks-autocapture'
import { assignableWindow, document } from '../../utils/globals'
import { autocaptureCompatibleElements } from '../../autocapture-utils'

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
    let lazyLoadedDeadClicksAutocapture: LazyLoadedDeadClicksAutocapture

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

        lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance)
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

        it('does not store clicks after stop', () => {
            lazyLoadedDeadClicksAutocapture.start(document)
            lazyLoadedDeadClicksAutocapture.stop()

            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(0)
        })

        it('sets timer when detecting clicks', () => {
            expect(lazyLoadedDeadClicksAutocapture['_checkClickTimer']).toBe(undefined)

            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_checkClickTimer']).not.toBe(undefined)
        })
    })

    it('tracks last scroll', () => {
        jest.setSystemTime(1000)
        triggerMouseEvent(document.body, 'click')

        expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].scrollDelayMs).not.toBeDefined()

        jest.setSystemTime(1050)
        triggerMouseEvent(document.body, 'scroll')

        expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].scrollDelayMs).toBe(50)
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

        it.each(autocaptureCompatibleElements)('click on %s node is never a deadclick', (element) => {
            const el = document.createElement(element)
            document.body.append(el)
            triggerMouseEvent(el, 'click')
            jest.setSystemTime(4000)

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })
    })

    describe('dead click detection', () => {
        beforeEach(() => {
            jest.setSystemTime(0)
        })

        it('click followed by scroll, not a dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
                scrollDelayMs: 99,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click followed by mutation, not a dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = 1000

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click followed by a selection change, not a dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            lazyLoadedDeadClicksAutocapture['_lastSelectionChanged'] = 999

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click followed by a selection change outside of threshold, dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            lazyLoadedDeadClicksAutocapture['_lastSelectionChanged'] = 1000

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_click',
                {
                    // faked system timestamp isn't moving so this is negative
                    $dead_click_absolute_delay_ms: -900,
                    $dead_click_absolute_timeout: false,
                    $dead_click_event_timestamp: 900,
                    $dead_click_last_mutation_timestamp: undefined,
                    $dead_click_last_scroll_timestamp: undefined,
                    $dead_click_mutation_delay_ms: undefined,
                    $dead_click_mutation_timeout: false,
                    $dead_click_scroll_delay_ms: undefined,
                    $dead_click_scroll_timeout: false,
                    $dead_click_selection_changed_delay_ms: 100,
                    $dead_click_selection_changed_timeout: true,
                    $ce_version: 1,
                    $el_text: 'text',
                    $elements_chain: 'body:text="text"nth-child="2"nth-of-type="1"',
                    $elements: [
                        {
                            $el_text: 'text',
                            nth_child: 2,
                            nth_of_type: 1,
                            tag_name: 'body',
                        },
                    ],
                    $event_type: 'click',
                },
                { timestamp: new Date(900) }
            )
        })

        it('click followed by a mutation after threshold, dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = 900 + 2501

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_click',
                {
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
                    $dead_click_selection_changed_delay_ms: undefined,
                    $dead_click_selection_changed_timeout: false,
                    $ce_version: 1,
                    $el_text: 'text',
                    $elements_chain: 'body:text="text"nth-child="2"nth-of-type="1"',
                    $elements: [
                        {
                            $el_text: 'text',
                            nth_child: 2,
                            nth_of_type: 1,
                            tag_name: 'body',
                        },
                    ],
                    $event_type: 'click',
                },
                { timestamp: new Date(900) }
            )
        })

        it('click followed by a scroll after threshold, dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
                scrollDelayMs: 2501,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_click',
                {
                    // faked system timestamp isn't moving so this is negative
                    $dead_click_absolute_delay_ms: -900,
                    $dead_click_absolute_timeout: false,
                    $dead_click_event_timestamp: 900,
                    $dead_click_last_mutation_timestamp: undefined,
                    $dead_click_mutation_delay_ms: undefined,
                    $dead_click_mutation_timeout: false,
                    $dead_click_scroll_delay_ms: 2501,
                    $dead_click_scroll_timeout: true,
                    $dead_click_selection_changed_delay_ms: undefined,
                    $dead_click_selection_changed_timeout: false,
                    $ce_version: 1,
                    $el_text: 'text',
                    $elements_chain: 'body:text="text"nth-child="2"nth-of-type="1"',
                    $elements: [
                        {
                            $el_text: 'text',
                            nth_child: 2,
                            nth_of_type: 1,
                            tag_name: 'body',
                        },
                    ],
                    $event_type: 'click',
                },
                { timestamp: new Date(900) }
            )
        })

        it('click followed by nothing for too long, dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            jest.setSystemTime(3001 + 900)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_click',
                {
                    $dead_click_absolute_delay_ms: 3001,
                    $dead_click_absolute_timeout: true,
                    $dead_click_event_timestamp: 900,
                    $dead_click_last_mutation_timestamp: undefined,
                    $dead_click_last_scroll_timestamp: undefined,
                    $dead_click_mutation_delay_ms: undefined,
                    $dead_click_mutation_timeout: false,
                    $dead_click_scroll_delay_ms: undefined,
                    $dead_click_scroll_timeout: false,
                    $dead_click_selection_changed_delay_ms: undefined,
                    $dead_click_selection_changed_timeout: false,
                    $ce_version: 1,
                    $el_text: 'text',
                    $elements_chain: 'body:text="text"nth-child="2"nth-of-type="1"',
                    $elements: [
                        {
                            $el_text: 'text',
                            nth_child: 2,
                            nth_of_type: 1,
                            tag_name: 'body',
                        },
                    ],
                    $event_type: 'click',
                },
                { timestamp: new Date(900) }
            )
        })

        it('click not followed by anything within threshold, rescheduled for next check', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            jest.setSystemTime(25 + 900)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })
    })

    it('can have alternative behaviour for onCapture', () => {
        jest.setSystemTime(0)
        const replacementCapture = jest.fn()

        lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance, {
            __onCapture: replacementCapture,
        })
        lazyLoadedDeadClicksAutocapture.start(document)

        lazyLoadedDeadClicksAutocapture['_clicks'].push({
            node: document.body,
            originalEvent: { type: 'click' } as MouseEvent,
            timestamp: 900,
        })
        lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

        jest.setSystemTime(3001 + 900)
        lazyLoadedDeadClicksAutocapture['_checkClicks']()

        expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        expect(fakeInstance.capture).not.toHaveBeenCalled()
        expect(replacementCapture).toHaveBeenCalled()
    })
})
