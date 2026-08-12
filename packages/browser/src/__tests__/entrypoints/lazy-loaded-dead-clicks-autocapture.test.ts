import { PostHog } from '../../posthog-core'
import LazyLoadedDeadClicksAutocapture from '../../entrypoints/dead-clicks-autocapture'
import { document } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../utils/globals'

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
                capture_dead_clicks: true,
                api_host: 'https://us.i.posthog.com',
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

        it('visibility change shortly after click, not a dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            // the visibilitychange fires 99ms after the click and is stamped onto the queued
            // candidate the moment it fires, so the click is treated as having done something
            jest.setSystemTime(999)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click ~800ms after the tab becomes visible is suppressed as a wake-up click', () => {
            // the tab becomes visible at t=200; 800ms later the user clicks the body to focus the
            // page. that click does nothing but is not dead, and the gap is wider than the old 100ms
            // window allowed — the before-the-click direction is recorded when the candidate is queued
            jest.setSystemTime(200)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            jest.setSystemTime(1000)
            triggerMouseEvent(document.body, 'click')

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('a stale visibility change well before the click is ignored, so the click keeps waiting', () => {
            // a visibility change 1500ms before the click is outside the wake-up window, so the
            // candidate records no visibility delay and the change neither suppresses nor marks it dead
            jest.setSystemTime(500)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            jest.setSystemTime(2000)
            triggerMouseEvent(document.body, 'click')

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            // the stale change decides nothing: the click stays queued until another signal or the
            // absolute timeout resolves it, and carries no misleading visibility delay
            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].visibilityChangedDelayMs).toBeUndefined()
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('a stale shared visibility timestamp from before the click does not mark the click dead', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: -3000,
            })
            // the tab was backgrounded long before this click. the old code read this shared timestamp
            // at check time and turned the large gap into a spurious multi-second "response", flagging
            // the click as dead via the visibility branch. the check no longer reads it, so the
            // candidate has no in-window visibility signal
            lazyLoadedDeadClicksAutocapture['_lastVisibilityChange'] = -5000

            jest.setSystemTime(1000)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            // it is still captured (via the absolute timeout), but the visibility branch never marks
            // a click dead and it carries no misleading visibility delay
            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_click',
                expect.objectContaining({
                    $dead_click_absolute_timeout: true,
                    $dead_click_visibility_changed_timeout: false,
                    $dead_click_visibility_changed_delay_ms: undefined,
                }),
                { timestamp: new Date(-3000) }
            )
        })

        it('click that hides the tab is suppressed even when the tab returns long after (delayed hide→show)', () => {
            // the click opens a new tab at t=1000 and the tab is hidden ~1ms later. `_checkClicks` is
            // suspended while the tab is backgrounded; the user returns 10s later, firing a second
            // visibilitychange. because the click-correlated hide was stamped onto the candidate when
            // it fired, the later show cannot overwrite it — so the click is correctly suppressed
            // rather than flagged dead by the absolute timeout. this is the regression the single
            // shared `_lastVisibilityChange` timestamp used to cause.
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 1000,
            })

            jest.setSystemTime(1001)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            jest.setSystemTime(11000)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click that opens a new window (window loses focus shortly after) is suppressed, not a dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            // the click opened a new window/popup: the tab stays visible, so the only trace is the
            // current window losing focus ~50ms later, stamped onto the candidate as the blur fires
            jest.setSystemTime(950)
            lazyLoadedDeadClicksAutocapture['_onFocusChange']()

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click that opens a new window is suppressed even when focus returns long after (delayed blur→focus)', () => {
            // same regression as the delayed hide→show case, for window focus/blur: the click blurs
            // the window at ~1ms, focus returns 10s later, and the click-correlated blur must not be
            // overwritten by the later focus
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 1000,
            })

            jest.setSystemTime(1001)
            lazyLoadedDeadClicksAutocapture['_onFocusChange']()

            jest.setSystemTime(11000)
            lazyLoadedDeadClicksAutocapture['_onFocusChange']()

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('a stale focus change well before the click does not suppress or mark it dead', () => {
            // a window focus/blur 1500ms before the click is outside the window, so it records no delay
            jest.setSystemTime(500)
            lazyLoadedDeadClicksAutocapture['_onFocusChange']()

            jest.setSystemTime(2000)
            triggerMouseEvent(document.body, 'click')

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].focusChangedDelayMs).toBeUndefined()
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

    describe('network liveness signal', () => {
        let originalFetch: typeof fetch | undefined

        beforeEach(() => {
            // reset any observer the outer start() installed, then snapshot the real fetch
            lazyLoadedDeadClicksAutocapture['_stopNetworkObserver']()
            originalFetch = assignableWindow.fetch
        })

        afterEach(() => {
            assignableWindow.fetch = originalFetch as typeof fetch
        })

        const installOver = (impl: unknown) => {
            lazyLoadedDeadClicksAutocapture['_stopNetworkObserver']()
            assignableWindow.fetch = impl as typeof fetch
            lazyLoadedDeadClicksAutocapture['_startNetworkObserver']()
        }

        const queueClickAt = (timestamp: number) => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp,
            })
        }

        it('suppresses a dead click when a fetch started shortly after it', () => {
            queueClickAt(900)
            // a request started 50ms after the click — the click kicked off async work
            lazyLoadedDeadClicksAutocapture['_recordLivenessSignal']('networkRequestDelayMs', 950, 300)

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('stamps the queued candidate and passes the call through to the underlying fetch', () => {
            const underlying = jest.fn().mockReturnValue('sentinel')
            installOver(underlying)
            queueClickAt(900)

            jest.setSystemTime(950)
            const result = (assignableWindow.fetch as (...a: unknown[]) => unknown)('https://example.com/api', {
                method: 'POST',
            })

            expect(underlying).toHaveBeenCalledWith('https://example.com/api', { method: 'POST' })
            expect(result).toBe('sentinel')
            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].networkRequestDelayMs).toBe(50)
        })

        it("ignores PostHog's own requests so they can't stand in as a click's response", () => {
            const underlying = jest.fn()
            installOver(underlying)
            queueClickAt(900)

            jest.setSystemTime(950)
            // api_host is https://us.i.posthog.com in the fake instance config
            ;(assignableWindow.fetch as (...a: unknown[]) => unknown)('https://us.i.posthog.com/e/')

            expect(underlying).toHaveBeenCalled()
            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].networkRequestDelayMs).toBeUndefined()
        })

        it('still stamps for an app request whose URL merely contains a PostHog host in the query', () => {
            const underlying = jest.fn()
            installOver(underlying)
            queueClickAt(900)

            jest.setSystemTime(950)
            ;(assignableWindow.fetch as (...a: unknown[]) => unknown)(
                'https://app.example.com/track?ref=us.i.posthog.com'
            )

            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].networkRequestDelayMs).toBe(50)
        })

        it('a request beyond the tight window does not stamp the candidate', () => {
            const underlying = jest.fn()
            installOver(underlying)
            queueClickAt(900)

            jest.setSystemTime(1300) // 400ms after the click, beyond the 300ms window
            ;(assignableWindow.fetch as (...a: unknown[]) => unknown)('https://example.com/api')

            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].networkRequestDelayMs).toBeUndefined()
        })

        it('does not throw and leaves fetch untouched when window.fetch is non-writable (hardened page)', () => {
            lazyLoadedDeadClicksAutocapture['_stopNetworkObserver']()
            const frozen = jest.fn()
            Object.defineProperty(assignableWindow, 'fetch', { value: frozen, writable: false, configurable: true })

            // patch swallows the failed assignment and returns a noop, so init never throws
            expect(() => lazyLoadedDeadClicksAutocapture['_startNetworkObserver']()).not.toThrow()
            expect(assignableWindow.fetch).toBe(frozen)

            Object.defineProperty(assignableWindow, 'fetch', {
                value: originalFetch,
                writable: true,
                configurable: true,
            })
        })
    })
})
