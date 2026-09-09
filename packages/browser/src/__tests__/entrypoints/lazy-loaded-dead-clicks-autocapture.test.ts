import { PostHog } from '../../posthog-core'
import LazyLoadedDeadClicksAutocapture from '../../entrypoints/dead-clicks-autocapture'
import { document } from '@posthog/browser-common/utils/globals'
import { assignableWindow } from '../../utils/globals'

// need to fake the timer before jsdom inits
vi.useFakeTimers()
vi.setSystemTime(1000)

const triggerMouseEvent = function (node: EventTarget, eventType: string, options?: MouseEventInit) {
    node.dispatchEvent(
        new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            ...options,
        })
    )
}

describe('LazyLoadedDeadClicksAutocapture', () => {
    let fakeInstance: PostHog
    let lazyLoadedDeadClicksAutocapture: LazyLoadedDeadClicksAutocapture
    let selection: { type: 'None' | 'Caret' | 'Range'; focusNode: Node | null } | null

    beforeEach(async () => {
        vi.setSystemTime(1000)
        selection = { type: 'Caret', focusNode: null }
        vi.spyOn(document, 'getSelection').mockImplementation(() => selection as Selection | null)

        assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
        assignableWindow.__PosthogExtensions__.loadExternalDependency = vi
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
            capture: vi.fn(),
        } as unknown as Partial<PostHog> as PostHog

        lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance)
        lazyLoadedDeadClicksAutocapture.start(document)
    })

    afterEach(() => {
        lazyLoadedDeadClicksAutocapture.stop()
        vi.mocked(document.getSelection).mockRestore()
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
        vi.setSystemTime(1000)
        triggerMouseEvent(document.body, 'click')

        expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].scrollDelayMs).not.toBeDefined()

        vi.setSystemTime(1050)
        triggerMouseEvent(document.body, 'scroll')

        expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].scrollDelayMs).toBe(50)
    })

    it('tracks selection changes dispatched by document', () => {
        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBeUndefined()

        selection!.type = 'Range'
        vi.setSystemTime(1050)
        document.dispatchEvent(new Event('selectionchange'))

        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(1050)
    })

    it('stops tracking document selection changes after stop', () => {
        lazyLoadedDeadClicksAutocapture.stop()

        selection!.type = 'Range'
        vi.setSystemTime(1050)
        document.dispatchEvent(new Event('selectionchange'))

        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBeUndefined()
    })

    it('does not suppress or time out a click for collapsed selection changes on non-editable content', () => {
        vi.setSystemTime(950)
        document.dispatchEvent(new Event('selectionchange'))

        vi.setSystemTime(1000)
        triggerMouseEvent(document.body, 'click')

        vi.setSystemTime(1050)
        document.dispatchEvent(new Event('selectionchange'))
        vi.setSystemTime(1200)
        document.dispatchEvent(new Event('selectionchange'))

        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBeUndefined()
        expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].selectionChangedDelayMs).toBeUndefined()

        vi.setSystemTime(4000)
        lazyLoadedDeadClicksAutocapture['_checkClicks']()

        expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        expect(fakeInstance.capture).toHaveBeenCalledWith(
            '$dead_click',
            expect.objectContaining({
                $dead_click_absolute_timeout: true,
                $dead_click_selection_changed_timeout: false,
            }),
            { timestamp: new Date(1000) }
        )
    })

    it.each(['Caret', 'None', null] as const)('suppresses a click when a range selection becomes %s', (type) => {
        selection!.type = 'Range'
        vi.setSystemTime(500)
        document.dispatchEvent(new Event('selectionchange'))

        selection = type ? { type, focusNode: null } : null
        vi.setSystemTime(950)
        document.dispatchEvent(new Event('selectionchange'))

        vi.setSystemTime(1000)
        triggerMouseEvent(document.body, 'click')
        expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].selectionChangedDelayMs).toBe(50)
        lazyLoadedDeadClicksAutocapture['_checkClicks']()
        expect(fakeInstance.capture).not.toHaveBeenCalled()

        vi.setSystemTime(1200)
        document.dispatchEvent(new Event('selectionchange'))
        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(950)
    })

    it('recognizes clearing a selection that existed before the detector started', () => {
        lazyLoadedDeadClicksAutocapture.stop()
        selection!.type = 'Range'
        lazyLoadedDeadClicksAutocapture.start(document)
        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBeUndefined()

        selection!.type = 'Caret'
        vi.setSystemTime(1050)
        document.dispatchEvent(new Event('selectionchange'))

        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(1050)
    })

    it('refreshes selection state on restart without counting a caret move as activity', () => {
        selection!.type = 'Range'
        vi.setSystemTime(500)
        document.dispatchEvent(new Event('selectionchange'))
        lazyLoadedDeadClicksAutocapture.stop()

        selection!.type = 'Caret'
        lazyLoadedDeadClicksAutocapture.start(document)
        vi.setSystemTime(1050)
        document.dispatchEvent(new Event('selectionchange'))

        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(500)
    })

    it.each(['input', 'textarea'])('tracks caret changes dispatched by a %s', (tag) => {
        const element = document.createElement(tag)
        document.body.appendChild(element)
        vi.setSystemTime(1050)
        element.dispatchEvent(new Event('selectionchange', { bubbles: true }))
        element.remove()

        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(1050)
    })

    it.each(['element', 'text'])('tracks an editable caret whose focus node is an %s node', (nodeType) => {
        const editor = document.createElement('div')
        editor.setAttribute('contenteditable', 'true')
        selection!.focusNode = nodeType === 'element' ? editor : editor.appendChild(document.createTextNode('text'))

        vi.setSystemTime(1050)
        document.dispatchEvent(new Event('selectionchange'))

        expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(1050)
    })

    it.each([undefined, 'open', 'closed'] as const)(
        'tracks the active editor with retargeted selection endpoints (shadow=%s)',
        (mode) => {
            const host = document.createElement('div')
            const editor = document.createElement('input')
            const root = mode ? host.attachShadow({ mode }) : host
            root.appendChild(editor)
            document.body.appendChild(host)
            try {
                editor.focus()
                selection!.focusNode = document.body
                vi.setSystemTime(1050)
                document.dispatchEvent(new Event('selectionchange'))
                expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(1050)

                host.remove()
                vi.setSystemTime(1100)
                document.dispatchEvent(new Event('selectionchange'))
                expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(1050)
            } finally {
                host.remove()
            }
        }
    )

    describe('selection during a mouse gesture', () => {
        let target: HTMLElement
        let other: HTMLElement

        beforeEach(() => {
            target = document.createElement('div')
            other = document.createElement('div')
            document.body.append(target, other)
            selection!.focusNode = target
        })

        afterEach(() => {
            target.remove()
            other.remove()
        })

        function press() {
            triggerMouseEvent(target, 'mousedown', { detail: 1 })
        }

        function select(node: Node = target) {
            selection!.type = 'Range'
            selection!.focusNode = node
            document.dispatchEvent(new Event('selectionchange'))
        }

        function release(node: Node = target, detail = 1) {
            triggerMouseEvent(node, 'mouseup', { detail })
            triggerMouseEvent(node, 'click', { detail })
        }

        function checkAfterClick(timestamp: number) {
            vi.setSystemTime(timestamp + 3005)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()
        }

        it.each([104, 2664])('remembers selection clearing %i ms before release', (delay) => {
            select()
            vi.setSystemTime(2000)
            press()
            vi.setSystemTime(2006)
            selection!.type = 'Caret'
            document.dispatchEvent(new Event('selectionchange'))
            vi.setSystemTime(2006 + delay)
            release()
            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].timestamp).toBe(2006 + delay)
            checkAfterClick(2006 + delay)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('remembers a range created late in a long press', () => {
            press()
            vi.setSystemTime(2000)
            select()
            vi.setSystemTime(4000)
            release()
            checkAfterClick(4000)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('remembers an input caret change during a long press', () => {
            const input = document.createElement('input')
            target.appendChild(input)
            triggerMouseEvent(input, 'mousedown', { detail: 1 })
            vi.setSystemTime(1006)
            input.dispatchEvent(new Event('selectionchange', { bubbles: true }))
            vi.setSystemTime(3670)
            release(input)
            checkAfterClick(3670)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('matches the active editor when the caret is in a nested span', () => {
            target.setAttribute('contenteditable', 'true')
            target.tabIndex = 0
            const span = document.createElement('span')
            target.appendChild(span)
            target.focus()
            press()
            selection!.focusNode = span.appendChild(document.createTextNode('Editable text'))
            vi.setSystemTime(1006)
            document.dispatchEvent(new Event('selectionchange'))
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('does not extend ambiguous closed-root caret suppression across a long press', () => {
            target.attachShadow({ mode: 'closed' })
            target.tabIndex = 0
            target.focus()
            press()
            selection!.focusNode = document.body
            vi.setSystemTime(1006)
            document.dispatchEvent(new Event('selectionchange'))
            expect(lazyLoadedDeadClicksAutocapture['_lastSelectionChanged']).toBe(1006)
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })

        it.each([true, false])('requires range ownership for endpoint-less clearing (related=%s)', (related) => {
            select(related ? target : other)
            vi.setSystemTime(2000)
            press()
            vi.setSystemTime(2006)
            selection = { type: 'None', focusNode: null }
            document.dispatchEvent(new Event('selectionchange'))
            vi.setSystemTime(4670)
            release()
            checkAfterClick(4670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(related ? 0 : 1)
        })

        it.each([true, false])(
            'resolves retargeted range boundaries without adopting siblings (related=%s)',
            (related) => {
                press()
                const range = document.createRange()
                range.setStartBefore(related ? target : other)
                range.collapse(true)
                Object.assign(selection!, {
                    type: 'Range',
                    focusNode: range.startContainer,
                    anchorNode: range.startContainer,
                    rangeCount: 1,
                    getRangeAt: () => range,
                })
                vi.setSystemTime(1006)
                document.dispatchEvent(new Event('selectionchange'))
                vi.setSystemTime(3670)
                release()
                checkAfterClick(3670)
                expect(fakeInstance.capture).toHaveBeenCalledTimes(related ? 0 : 1)
            }
        )

        it('does not adopt a sibling range whose endpoints are in a shared parent', () => {
            press()
            const range = document.createRange()
            range.selectNode(other)
            Object.assign(selection!, {
                type: 'Range',
                focusNode: range.endContainer,
                anchorNode: range.startContainer,
                rangeCount: 1,
                getRangeAt: () => range,
            })
            vi.setSystemTime(1006)
            document.dispatchEvent(new Event('selectionchange'))
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })

        it('recognizes a nested text endpoint after pressing its container padding', () => {
            const span = document.createElement('span')
            const text = document.createTextNode('Nested selected text')
            span.appendChild(text)
            target.appendChild(span)
            select(text)
            vi.setSystemTime(2000)
            press()
            vi.setSystemTime(2006)
            selection!.type = 'Caret'
            document.dispatchEvent(new Event('selectionchange'))
            vi.setSystemTime(4670)
            release()
            checkAfterClick(4670)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('matches exposed selection endpoints behind a closed shadow host', () => {
            const span = document.createElement('span')
            target.attachShadow({ mode: 'closed' }).appendChild(span)
            press()
            vi.setSystemTime(1006)
            select(span.appendChild(document.createTextNode('Selected text')))
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('does not associate another input’s selection event with the press', () => {
            const input = document.createElement('input')
            other.appendChild(input)
            press()
            vi.setSystemTime(1006)
            input.dispatchEvent(new Event('selectionchange', { bubbles: true }))
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })

        it('does not associate a press with a different click target', () => {
            press()
            vi.setSystemTime(1006)
            select()
            vi.setSystemTime(3670)
            triggerMouseEvent(target, 'mouseup', { detail: 1 })
            triggerMouseEvent(other, 'click', { detail: 1 })
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })

        it('discards gesture state when the page is hidden', () => {
            const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
            try {
                press()
                vi.setSystemTime(1006)
                select()
                document.dispatchEvent(new Event('visibilitychange'))
                vi.setSystemTime(3670)
                release()
                checkAfterClick(3670)
                expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
            } finally {
                visibility.mockRestore()
            }
        })

        it('keeps inert caret movement dead and starts its timeout at release', () => {
            press()
            vi.setSystemTime(1006)
            document.dispatchEvent(new Event('selectionchange'))
            vi.setSystemTime(3670)
            release()
            lazyLoadedDeadClicksAutocapture['_checkClicks']()
            expect(fakeInstance.capture).not.toHaveBeenCalled()
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_click',
                expect.objectContaining({ $dead_click_absolute_timeout: true }),
                { timestamp: new Date(3670) }
            )
        })

        it('does not extend activity from a different element to the held click', () => {
            press()
            vi.setSystemTime(1006)
            select(other)
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })

        it('matches a click on the common ancestor of different press/release descendants', () => {
            const first = document.createElement('span')
            const second = document.createElement('span')
            target.append(first, second)
            triggerMouseEvent(first, 'mousedown', { detail: 1 })
            vi.setSystemTime(1006)
            select(first)
            vi.setSystemTime(3670)
            triggerMouseEvent(second, 'mouseup', { detail: 1 })
            triggerMouseEvent(target, 'click', { detail: 1 })
            checkAfterClick(3670)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it.each(['blur', 'dragstart', 'pointercancel', 'mouseout'])('discards the gesture on %s', (event) => {
            press()
            vi.setSystemTime(1006)
            select()
            triggerMouseEvent(assignableWindow, event)
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })

        it('does not cancel a press when the window gains focus', () => {
            press()
            assignableWindow.dispatchEvent(new Event('focus'))
            vi.setSystemTime(1006)
            select()
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('does not transfer a completed gesture to a later click', () => {
            press()
            vi.setSystemTime(1006)
            select()
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            triggerMouseEvent(target, 'click', { detail: 1 })
            checkAfterClick(6675)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
            expect(fakeInstance.capture).toHaveBeenCalledWith('$dead_click', expect.anything(), {
                timestamp: new Date(6675),
            })
        })

        it('expires a release that does not produce a click', () => {
            press()
            vi.setSystemTime(1006)
            select()
            vi.setSystemTime(3670)
            triggerMouseEvent(target, 'mouseup', { detail: 1 })
            vi.advanceTimersByTime(0)
            triggerMouseEvent(target, 'click', { detail: 1 })
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })

        it('does not let keyboard/programmatic activation consume the mouse gesture', () => {
            other.id = 'unrelated-activation'
            press()
            vi.setSystemTime(1006)
            select()
            vi.setSystemTime(3670)
            triggerMouseEvent(target, 'mouseup', { detail: 1 })
            triggerMouseEvent(other, 'click', { detail: 0 })
            triggerMouseEvent(target, 'click', { detail: 1 })
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
            expect(vi.mocked(fakeInstance.capture).mock.calls[0][1]?.$elements[0].attr__id).toBe('unrelated-activation')
        })

        it('preserves repeated-click deduplication for a gesture with selection activity', () => {
            press()
            vi.setSystemTime(1006)
            select()
            vi.setSystemTime(3670)
            release()
            vi.setSystemTime(3800)
            triggerMouseEvent(target, 'click', { detail: 1 })
            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            checkAfterClick(3670)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('does not carry a press across stop/restart', () => {
            press()
            vi.setSystemTime(1006)
            select()
            lazyLoadedDeadClicksAutocapture.stop()
            lazyLoadedDeadClicksAutocapture.start(document)
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })

        it.each([1, 500])('retains gesture activity with a custom %i ms window', (threshold) => {
            lazyLoadedDeadClicksAutocapture.stop()
            lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance, {
                selection_change_threshold_ms: threshold,
            })
            lazyLoadedDeadClicksAutocapture.start(document)
            press()
            vi.setSystemTime(1006)
            select()
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('keeps a zero selection threshold from suppressing gesture clicks', () => {
            lazyLoadedDeadClicksAutocapture.stop()
            lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance, {
                selection_change_threshold_ms: 0,
            })
            lazyLoadedDeadClicksAutocapture.start(document)
            press()
            vi.setSystemTime(1006)
            select()
            vi.setSystemTime(3670)
            release()
            checkAfterClick(3670)
            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
        })
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
            vi.setSystemTime(1000)
            triggerMouseEvent(document.body, 'click')

            vi.setSystemTime(1999)
            triggerMouseEvent(document.body, 'click')

            vi.setSystemTime(2000)
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
            vi.setSystemTime(4000)

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
            vi.setSystemTime(4000)

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
            vi.setSystemTime(0)
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

            selection!.type = 'Range'
            vi.setSystemTime(999)
            document.dispatchEvent(new Event('selectionchange'))

            // A later selection change must not overwrite the click-correlated one.
            vi.setSystemTime(1200)
            document.dispatchEvent(new Event('selectionchange'))

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('selection change just before a click suppresses it without bypassing repeated-click deduplication', () => {
            selection!.type = 'Range'
            vi.setSystemTime(900)
            document.dispatchEvent(new Event('selectionchange'))

            vi.setSystemTime(950)
            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].selectionChangedDelayMs).toBe(50)

            // The selection window has elapsed, but this is still a repeat click on the same node.
            vi.setSystemTime(1051)
            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('a stale pre-click selection change does not suppress or time out the click', () => {
            selection!.type = 'Range'
            vi.setSystemTime(500)
            document.dispatchEvent(new Event('selectionchange'))

            vi.setSystemTime(1000)
            triggerMouseEvent(document.body, 'click')

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].selectionChangedDelayMs).toBeUndefined()

            vi.setSystemTime(4000)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_click',
                expect.objectContaining({
                    $dead_click_absolute_timeout: true,
                    $dead_click_selection_changed_delay_ms: undefined,
                    $dead_click_selection_changed_timeout: false,
                }),
                { timestamp: new Date(1000) }
            )
        })

        it('visibility change shortly after click, not a dead click', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'click' } as MouseEvent,
                timestamp: 900,
            })
            // the visibilitychange fires 99ms after the click and is stamped onto the queued
            // candidate the moment it fires, so the click is treated as having done something
            vi.setSystemTime(999)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('click ~800ms after the tab becomes visible is suppressed as a wake-up click', () => {
            // the tab becomes visible at t=200; 800ms later the user clicks the body to focus the
            // page. that click does nothing but is not dead, and the gap is wider than the old 100ms
            // window allowed — the before-the-click direction is recorded when the candidate is queued
            vi.setSystemTime(200)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            vi.setSystemTime(1000)
            triggerMouseEvent(document.body, 'click')

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('a stale visibility change well before the click is ignored, so the click keeps waiting', () => {
            // a visibility change 1500ms before the click is outside the wake-up window, so the
            // candidate records no visibility delay and the change neither suppresses nor marks it dead
            vi.setSystemTime(500)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            vi.setSystemTime(2000)
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

            vi.setSystemTime(1000)
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

            vi.setSystemTime(1001)
            lazyLoadedDeadClicksAutocapture['_onVisibilityChange']()

            vi.setSystemTime(11000)
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
            vi.setSystemTime(950)
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

            vi.setSystemTime(1001)
            lazyLoadedDeadClicksAutocapture['_onFocusChange']()

            vi.setSystemTime(11000)
            lazyLoadedDeadClicksAutocapture['_onFocusChange']()

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('a stale focus change well before the click does not suppress or mark it dead', () => {
            // a window focus/blur 1500ms before the click is outside the window, so it records no delay
            vi.setSystemTime(500)
            lazyLoadedDeadClicksAutocapture['_onFocusChange']()

            vi.setSystemTime(2000)
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
                selectionChangedDelayMs: 100,
            })

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

            vi.setSystemTime(3001 + 900)
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

            vi.setSystemTime(25 + 900)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })
    })

    it('can have alternative behaviour for onCapture', () => {
        vi.setSystemTime(0)
        const replacementCapture = vi.fn()

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

        vi.setSystemTime(3001 + 900)
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
