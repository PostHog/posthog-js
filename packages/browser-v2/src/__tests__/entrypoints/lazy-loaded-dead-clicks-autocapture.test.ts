import { PostHog } from '../../posthog-core'
import LazyLoadedDeadClicksAutocapture from '../../entrypoints/dead-clicks-autocapture'
import { assignableWindow, document } from '../../utils/globals'

// need to fake the timer before jsdom inits
jest.useFakeTimers()
jest.setSystemTime(1000)

const triggerMouseEvent = function (
    node: Node,
    eventType: string,
    options?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }
) {
    node.dispatchEvent(
        new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            ctrlKey: options?.ctrlKey,
            metaKey: options?.metaKey,
            altKey: options?.altKey,
            shiftKey: options?.shiftKey,
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
                captureDeadClicks: true,
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

        it('click on an anchor is never a deadclick', () => {
            const anchor = document.createElement('a')
            anchor.setAttribute('href', '/some/file.pdf')
            document.body.append(anchor)
            triggerMouseEvent(anchor, 'click')
            jest.setSystemTime(4000)

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click on a child of an anchor is never a deadclick', () => {
            const anchor = document.createElement('a')
            anchor.setAttribute('href', '/some/file.pdf')
            const child = document.createElement('span')
            anchor.appendChild(child)
            document.body.append(anchor)

            triggerMouseEvent(child, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('click on a deeply nested child of an anchor is never a deadclick', () => {
            const anchor = document.createElement('a')
            anchor.setAttribute('href', '/some/file.pdf')
            const wrapper = document.createElement('div')
            const icon = document.createElement('svg')
            wrapper.appendChild(icon)
            anchor.appendChild(wrapper)
            document.body.append(anchor)

            triggerMouseEvent(icon, 'click')
            jest.setSystemTime(4000)

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click on a child of an anchor inside a shadow root is never a deadclick', () => {
            const host = document.createElement('div')
            const shadowRoot = host.attachShadow({ mode: 'open' })
            const anchor = document.createElement('a')
            anchor.setAttribute('href', '/some/file.pdf')
            const child = document.createElement('span')
            anchor.appendChild(child)
            shadowRoot.appendChild(anchor)
            document.body.append(host)

            triggerMouseEvent(child, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        // buttons, inputs, selects, textareas, labels, forms all rely on app JS handlers
        // (or browser-native side effects we can observe via mutation/scroll/selection).
        // If the handler ran, our observers catch the effect; if it didn't, dead-click
        // correctly surfaces the bug. A click on a broken <button> with no handler
        // should still flag — that's exactly the case we want to catch.
        it.each(['button', 'input', 'select', 'textarea', 'label', 'form'])(
            'click on a %s is still a candidate',
            (tag) => {
                const el = document.createElement(tag)
                document.body.append(el)

                triggerMouseEvent(el, 'click')

                expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            }
        )

        it.each(['button', 'input', 'select', 'textarea', 'label', 'form'])(
            'click on a child of a %s is still a candidate',
            (ancestorTag) => {
                const ancestor = document.createElement(ancestorTag)
                const child = document.createElement('span')
                ancestor.appendChild(child)
                document.body.append(ancestor)

                triggerMouseEvent(child, 'click')

                expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            }
        )

        it('click on a non-interactive element with no interactive ancestor is still a candidate', () => {
            const div = document.createElement('div')
            document.body.append(div)

            triggerMouseEvent(div, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
        })

        it.each(['ph-no-deadclick', 'ph-no-capture'])('ignores clicks on elements with the %s class', (className) => {
            const el = document.createElement('div')
            el.className = className
            document.body.append(el)

            triggerMouseEvent(el, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('ignores clicks on parents with the ph-no-deadclick class', () => {
            const parent = document.createElement('div')
            parent.className = 'ph-no-deadclick'
            const child = document.createElement('div')
            parent.appendChild(child)
            document.body.append(parent)

            triggerMouseEvent(child, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('respects a custom css_selector_ignorelist', () => {
            lazyLoadedDeadClicksAutocapture.stop()
            const customIgnore = new LazyLoadedDeadClicksAutocapture(fakeInstance, {
                css_selector_ignorelist: ['.custom-no-deadclick'],
            })
            customIgnore.start(document)

            const ignored = document.createElement('div')
            ignored.className = 'custom-no-deadclick'
            document.body.append(ignored)

            const notIgnoredWhenCustom = document.createElement('div')
            notIgnoredWhenCustom.className = 'ph-no-deadclick'
            document.body.append(notIgnoredWhenCustom)

            triggerMouseEvent(ignored, 'click')
            triggerMouseEvent(notIgnoredWhenCustom, 'click')

            // only the explicitly ignored element should be filtered out
            expect(customIgnore['_clicks'].map((c) => (c.node as Element).className)).toEqual(['ph-no-deadclick'])
            customIgnore.stop()
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

        it.each([
            { scenario: 'visibility change after click', clickTimestamp: 900, visibilityTimestamp: 999 },
            { scenario: 'visibility change just before click', clickTimestamp: 950, visibilityTimestamp: 900 },
        ])('$scenario, not a dead click', ({ clickTimestamp, visibilityTimestamp }) => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: clickTimestamp,
            })
            lazyLoadedDeadClicksAutocapture['_lastVisibilityChange'] = visibilityTimestamp

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
                    $ce_version: 1,
                    $dead_click_absolute_delay_ms: -900,
                    $dead_click_absolute_timeout: false,
                    $dead_click_event_timestamp: 900,
                    $dead_click_last_mutation_timestamp: undefined,
                    $dead_click_mutation_delay_ms: undefined,
                    $dead_click_mutation_timeout: false,
                    $dead_click_scroll_delay_ms: undefined,
                    $dead_click_scroll_timeout: false,
                    $dead_click_selection_changed_delay_ms: 100,
                    $dead_click_selection_changed_timeout: true,
                    $dead_click_visibility_changed_delay_ms: undefined,
                    $dead_click_visibility_changed_timeout: false,
                    $el_text: 'text',
                    $elements: [
                        {
                            $el_text: 'text',
                            nth_child: 2,
                            nth_of_type: 1,
                            tag_name: 'body',
                        },
                    ],
                    $elements_chain: 'body:nth-child="2"nth-of-type="1"text="text"',
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
                    $ce_version: 1,
                    $dead_click_absolute_delay_ms: -900,
                    $dead_click_absolute_timeout: false,
                    $dead_click_event_timestamp: 900,
                    $dead_click_last_mutation_timestamp: 3401,
                    $dead_click_mutation_delay_ms: 2501,
                    $dead_click_mutation_timeout: true,
                    $dead_click_scroll_delay_ms: undefined,
                    $dead_click_scroll_timeout: false,
                    $dead_click_selection_changed_delay_ms: undefined,
                    $dead_click_selection_changed_timeout: false,
                    $dead_click_visibility_changed_delay_ms: undefined,
                    $dead_click_visibility_changed_timeout: false,
                    $el_text: 'text',
                    $elements: [
                        {
                            $el_text: 'text',
                            nth_child: 2,
                            nth_of_type: 1,
                            tag_name: 'body',
                        },
                    ],
                    $elements_chain: 'body:nth-child="2"nth-of-type="1"text="text"',
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
                    $ce_version: 1,
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
                    $dead_click_visibility_changed_delay_ms: undefined,
                    $dead_click_visibility_changed_timeout: false,
                    $el_text: 'text',
                    $elements: [
                        {
                            $el_text: 'text',
                            nth_child: 2,
                            nth_of_type: 1,
                            tag_name: 'body',
                        },
                    ],
                    $elements_chain: 'body:nth-child="2"nth-of-type="1"text="text"',
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
                    $ce_version: 1,
                    $dead_click_absolute_delay_ms: 3001,
                    $dead_click_absolute_timeout: true,
                    $dead_click_event_timestamp: 900,
                    $dead_click_last_mutation_timestamp: undefined,
                    $dead_click_mutation_delay_ms: undefined,
                    $dead_click_mutation_timeout: false,
                    $dead_click_scroll_delay_ms: undefined,
                    $dead_click_scroll_timeout: false,
                    $dead_click_selection_changed_delay_ms: undefined,
                    $dead_click_selection_changed_timeout: false,
                    $dead_click_visibility_changed_delay_ms: undefined,
                    $dead_click_visibility_changed_timeout: false,
                    $el_text: 'text',
                    $elements: [
                        {
                            $el_text: 'text',
                            nth_child: 2,
                            nth_of_type: 1,
                            tag_name: 'body',
                        },
                    ],
                    $elements_chain: 'body:nth-child="2"nth-of-type="1"text="text"',
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

    describe('modifier key handling', () => {
        it.each([
            { key: 'ctrlKey', options: { ctrlKey: true } },
            { key: 'metaKey', options: { metaKey: true } },
            { key: 'altKey', options: { altKey: true } },
            { key: 'shiftKey', options: { shiftKey: true } },
        ])('ignores clicks with $key held down by default', ({ options }) => {
            triggerMouseEvent(document.body, 'click', options)

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(0)
        })

        it('captures regular clicks without modifier keys', () => {
            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(1)
        })

        it.each([
            { key: 'ctrlKey', options: { ctrlKey: true } },
            { key: 'metaKey', options: { metaKey: true } },
            { key: 'altKey', options: { altKey: true } },
            { key: 'shiftKey', options: { shiftKey: true } },
        ])('captures clicks with $key when capture_clicks_with_modifier_keys is true', ({ options }) => {
            lazyLoadedDeadClicksAutocapture.stop()
            lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance, {
                capture_clicks_with_modifier_keys: true,
            })
            lazyLoadedDeadClicksAutocapture.start(document)

            triggerMouseEvent(document.body, 'click', options)

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(1)
        })

        it('ignores clicks with multiple modifier keys held down', () => {
            triggerMouseEvent(document.body, 'click', { ctrlKey: true, shiftKey: true })

            expect(lazyLoadedDeadClicksAutocapture['_clicks'].length).toBe(0)
        })
    })
})
