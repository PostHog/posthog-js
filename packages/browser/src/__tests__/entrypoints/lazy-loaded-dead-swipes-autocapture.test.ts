import { PostHog } from '../../posthog-core'
import LazyLoadedDeadClicksAutocapture from '../../entrypoints/dead-clicks-autocapture'
import { assignableWindow, document } from '../../utils/globals'

// need to fake the timer before jsdom inits
jest.useFakeTimers()
jest.setSystemTime(1000)

// jsdom doesn't implement the Touch/TouchEvent constructors, so we fake just
// enough of the shape that the swipe observer reads (touches / changedTouches)
const triggerTouchEvent = function (
    node: Node,
    eventType: 'touchstart' | 'touchend' | 'touchcancel',
    points: { x: number; y: number }[]
) {
    const event = new Event(eventType, { bubbles: true, cancelable: true })
    const touchList = points.map((p) => ({ clientX: p.x, clientY: p.y }))
    Object.defineProperty(event, eventType === 'touchstart' ? 'touches' : 'changedTouches', {
        value: touchList,
        configurable: true,
    })
    node.dispatchEvent(event)
}

// dispatch a full swipe gesture (touchstart then touchend) between two points
const triggerSwipe = function (node: Node, from: { x: number; y: number }, to: { x: number; y: number }) {
    triggerTouchEvent(node, 'touchstart', [from])
    triggerTouchEvent(node, 'touchend', [to])
}

describe('LazyLoadedDeadClicksAutocapture - dead swipes', () => {
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

    describe('swipe detection', () => {
        it('starts without a touch start recorded', () => {
            expect(lazyLoadedDeadClicksAutocapture['_touchStart']).toBe(undefined)
        })

        it('records the touch start position', () => {
            triggerTouchEvent(document.body, 'touchstart', [{ x: 100, y: 100 }])

            expect(lazyLoadedDeadClicksAutocapture['_touchStart']).toEqual({ x: 100, y: 100, timestamp: 1000 })
        })

        it('stores a swipe candidate when the gesture is beyond the threshold', () => {
            triggerSwipe(document.body, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
            const candidate = lazyLoadedDeadClicksAutocapture['_clicks'][0]
            expect(candidate.type).toBe('swipe')
            expect(candidate.swipeDirection).toBe('up')
            expect(candidate.swipeDistancePx).toBe(160)
        })

        it('does not store a candidate for a tiny movement below the threshold', () => {
            triggerSwipe(document.body, { x: 100, y: 100 }, { x: 110, y: 105 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('does not store a candidate for a touchend with no preceding touchstart', () => {
            triggerTouchEvent(document.body, 'touchend', [{ x: 300, y: 40 }])

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('does not treat a multi-touch gesture (pinch/zoom) as a swipe', () => {
            // two fingers down => not a swipe, even if one finger travels far before lifting
            triggerTouchEvent(document.body, 'touchstart', [
                { x: 100, y: 200 },
                { x: 140, y: 200 },
            ])
            triggerTouchEvent(document.body, 'touchend', [{ x: 100, y: 40 }])

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('clears the tracked origin when a second finger lands mid-gesture', () => {
            triggerTouchEvent(document.body, 'touchstart', [{ x: 100, y: 200 }])
            // a second finger arriving turns this into a pinch, not a swipe
            triggerTouchEvent(document.body, 'touchstart', [
                { x: 100, y: 200 },
                { x: 140, y: 200 },
            ])

            expect(lazyLoadedDeadClicksAutocapture['_touchStart']).toBe(undefined)
        })

        it('clears the tracked origin on touchcancel so the next gesture is measured fresh', () => {
            triggerTouchEvent(document.body, 'touchstart', [{ x: 100, y: 200 }])
            triggerTouchEvent(document.body, 'touchcancel', [{ x: 100, y: 200 }])

            expect(lazyLoadedDeadClicksAutocapture['_touchStart']).toBe(undefined)

            // a plain tap after the cancelled gesture must not be measured against the stale origin
            triggerTouchEvent(document.body, 'touchend', [{ x: 100, y: 40 }])
            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('does not store swipes after stop', () => {
            lazyLoadedDeadClicksAutocapture.stop()

            triggerSwipe(document.body, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('sets the check timer when detecting a swipe', () => {
            expect(lazyLoadedDeadClicksAutocapture['_checkClickTimer']).toBe(undefined)

            triggerSwipe(document.body, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_checkClickTimer']).not.toBe(undefined)
        })

        it('uses the gesture start time so mutations during the swipe count as a response', () => {
            jest.setSystemTime(1000)
            triggerTouchEvent(document.body, 'touchstart', [{ x: 100, y: 200 }])
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = 1050
            jest.setSystemTime(1100)
            triggerTouchEvent(document.body, 'touchend', [{ x: 100, y: 40 }])

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('counts scrolling during the swipe as a response', () => {
            jest.setSystemTime(1000)
            triggerTouchEvent(document.body, 'touchstart', [{ x: 100, y: 200 }])
            jest.setSystemTime(1050)
            window.dispatchEvent(new Event('scroll'))
            jest.setSystemTime(1100)
            triggerTouchEvent(document.body, 'touchend', [{ x: 100, y: 40 }])

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it.each([
            { scenario: 'right', from: { x: 20, y: 100 }, to: { x: 120, y: 100 }, direction: 'right' },
            { scenario: 'left', from: { x: 120, y: 100 }, to: { x: 20, y: 100 }, direction: 'left' },
            { scenario: 'down', from: { x: 100, y: 20 }, to: { x: 100, y: 120 }, direction: 'down' },
            { scenario: 'up', from: { x: 100, y: 120 }, to: { x: 100, y: 20 }, direction: 'up' },
        ])('detects a $scenario swipe', ({ from, to, direction }) => {
            triggerSwipe(document.body, from, to)

            expect(lazyLoadedDeadClicksAutocapture['_clicks'][0].swipeDirection).toBe(direction)
        })
    })

    describe('swipe ignore', () => {
        it('ignores swipes on the html node', () => {
            const fakeHTML = document.createElement('html')
            document.body.append(fakeHTML)

            triggerSwipe(fakeHTML, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it.each(['ph-no-deadclick', 'ph-no-capture'])('ignores swipes on elements with the %s class', (className) => {
            const el = document.createElement('div')
            el.className = className
            document.body.append(el)

            triggerSwipe(el, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('ignores repeated swipes on the same node within one second', () => {
            const el = document.createElement('div')
            document.body.append(el)

            jest.setSystemTime(1000)
            triggerSwipe(el, { x: 100, y: 200 }, { x: 100, y: 40 })

            jest.setSystemTime(1500)
            triggerSwipe(el, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
        })

        it('unlike clicks, a swipe on an anchor is still a candidate', () => {
            const anchor = document.createElement('a')
            anchor.setAttribute('href', '/some/page')
            document.body.append(anchor)

            triggerSwipe(anchor, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(1)
        })
    })

    describe('config gating', () => {
        it('does not observe swipes when capture_dead_swipes is false', () => {
            lazyLoadedDeadClicksAutocapture.stop()
            lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance, {
                capture_dead_swipes: false,
            })
            lazyLoadedDeadClicksAutocapture.start(document)

            triggerSwipe(document.body, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('does not observe swipes when an external onCapture is provided (heatmaps path)', () => {
            lazyLoadedDeadClicksAutocapture.stop()
            lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance, {
                __onCapture: jest.fn(),
            })
            lazyLoadedDeadClicksAutocapture.start(document)

            triggerSwipe(document.body, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })

        it('respects a custom swipe_threshold_px', () => {
            lazyLoadedDeadClicksAutocapture.stop()
            lazyLoadedDeadClicksAutocapture = new LazyLoadedDeadClicksAutocapture(fakeInstance, {
                swipe_threshold_px: 200,
            })
            lazyLoadedDeadClicksAutocapture.start(document)

            // 160px is below the custom 200px threshold
            triggerSwipe(document.body, { x: 100, y: 200 }, { x: 100, y: 40 })

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
        })
    })

    describe('dead swipe capture', () => {
        beforeEach(() => {
            jest.setSystemTime(0)
        })

        it('swipe followed by scroll within threshold, not a dead swipe', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'touchend' } as unknown as TouchEvent,
                timestamp: 900,
                type: 'swipe',
                swipeDirection: 'up',
                swipeDistancePx: 160,
                scrollDelayMs: 99,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('swipe followed by mutation, not a dead swipe', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'touchend' } as unknown as TouchEvent,
                timestamp: 900,
                type: 'swipe',
                swipeDirection: 'up',
                swipeDistancePx: 160,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = 1000

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).not.toHaveBeenCalled()
        })

        it('swipe followed by a scroll after threshold, dead swipe', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'touchend' } as unknown as TouchEvent,
                timestamp: 900,
                type: 'swipe',
                swipeDirection: 'up',
                swipeDistancePx: 160,
                scrollDelayMs: 2501,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_swipe',
                expect.objectContaining({
                    $dead_swipe_absolute_delay_ms: -900,
                    $dead_swipe_absolute_timeout: false,
                    $dead_swipe_event_timestamp: 900,
                    $dead_swipe_mutation_delay_ms: undefined,
                    $dead_swipe_mutation_timeout: false,
                    $dead_swipe_scroll_delay_ms: 2501,
                    $dead_swipe_scroll_timeout: true,
                    $dead_swipe_selection_changed_delay_ms: undefined,
                    $dead_swipe_selection_changed_timeout: false,
                    $dead_swipe_visibility_changed_delay_ms: undefined,
                    $dead_swipe_visibility_changed_timeout: false,
                    $dead_swipe_direction: 'up',
                    $dead_swipe_distance_px: 160,
                    $event_type: 'touchend',
                }),
                { timestamp: new Date(900) }
            )
        })

        it('swipe followed by nothing for too long, dead swipe', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'touchend' } as unknown as TouchEvent,
                timestamp: 900,
                type: 'swipe',
                swipeDirection: 'left',
                swipeDistancePx: 120,
            })
            lazyLoadedDeadClicksAutocapture['_lastMutation'] = undefined

            jest.setSystemTime(3001 + 900)
            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(lazyLoadedDeadClicksAutocapture['_clicks']).toHaveLength(0)
            expect(fakeInstance.capture).toHaveBeenCalledWith(
                '$dead_swipe',
                expect.objectContaining({
                    $dead_swipe_absolute_delay_ms: 3001,
                    $dead_swipe_absolute_timeout: true,
                    $dead_swipe_direction: 'left',
                    $dead_swipe_distance_px: 120,
                }),
                { timestamp: new Date(900) }
            )
        })

        it('a swipe never captures a $dead_click event', () => {
            lazyLoadedDeadClicksAutocapture['_clicks'].push({
                node: document.body,
                originalEvent: { type: 'touchend' } as unknown as TouchEvent,
                timestamp: 900,
                type: 'swipe',
                swipeDirection: 'up',
                swipeDistancePx: 160,
                scrollDelayMs: 2501,
            })

            lazyLoadedDeadClicksAutocapture['_checkClicks']()

            expect(fakeInstance.capture).toHaveBeenCalledTimes(1)
            expect(fakeInstance.capture).not.toHaveBeenCalledWith('$dead_click', expect.anything(), expect.anything())
        })
    })
})
