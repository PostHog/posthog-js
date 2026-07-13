import { EventType } from '@posthog/rrweb-types'
import type { eventWithTime } from '@posthog/rrweb-types'

const now = Date.now()

// Document scrolled to 800 at snapshot time, on a page that sets `scroll-behavior: smooth`
// on the root. The full snapshot's initialOffset must be applied instantly, not animated.
const events: eventWithTime[] = [
    { type: EventType.DomContentLoaded, data: {}, timestamp: now },
    { type: EventType.Load, data: {}, timestamp: now + 100 },
    {
        type: EventType.Meta,
        data: { href: 'http://localhost', width: 1200, height: 600 },
        timestamp: now + 100,
    },
    {
        type: EventType.FullSnapshot,
        data: {
            node: {
                id: 1,
                type: 0,
                childNodes: [
                    { type: 1, name: 'html', publicId: '', systemId: '', id: 2 },
                    {
                        id: 3,
                        type: 2,
                        tagName: 'html',
                        attributes: { style: 'scroll-behavior: smooth;' },
                        childNodes: [
                            { id: 4, type: 2, tagName: 'head', attributes: {}, childNodes: [] },
                            {
                                id: 7,
                                type: 2,
                                tagName: 'body',
                                attributes: {},
                                childNodes: [
                                    {
                                        id: 100,
                                        type: 2,
                                        tagName: 'div',
                                        attributes: { style: 'height: 5000px; display: block;' },
                                        childNodes: [],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            initialOffset: { left: 0, top: 800 },
        },
        timestamp: now + 100,
    },
]

export default events
