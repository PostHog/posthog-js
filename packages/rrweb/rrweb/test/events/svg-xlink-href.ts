import { EventType, IncrementalSource } from '@posthog/rrweb-types'
import type { eventWithTime } from '@posthog/rrweb-types'

const now = Date.now()
const events: eventWithTime[] = [
    {
        type: EventType.DomContentLoaded,
        data: {},
        timestamp: now,
    },
    {
        type: EventType.Load,
        data: {},
        timestamp: now + 100,
    },
    {
        type: EventType.Meta,
        data: {
            href: 'http://localhost',
            width: 1200,
            height: 500,
        },
        timestamp: now + 100,
    },
    // full snapshot with an svg use element referencing a sprite
    {
        data: {
            node: {
                id: 1,
                type: 0,
                childNodes: [
                    { id: 2, name: 'html', type: 1, publicId: '', systemId: '' },
                    {
                        id: 3,
                        type: 2,
                        tagName: 'html',
                        attributes: {},
                        childNodes: [
                            {
                                id: 4,
                                type: 2,
                                tagName: 'head',
                                attributes: {},
                                childNodes: [],
                            },
                            {
                                id: 5,
                                type: 2,
                                tagName: 'body',
                                attributes: {},
                                childNodes: [
                                    {
                                        id: 6,
                                        type: 2,
                                        tagName: 'svg',
                                        attributes: {},
                                        childNodes: [
                                            {
                                                id: 7,
                                                type: 2,
                                                tagName: 'use',
                                                attributes: {},
                                                childNodes: [],
                                                isSVG: true,
                                            },
                                        ],
                                        isSVG: true,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            initialOffset: { top: 0, left: 0 },
        },
        type: EventType.FullSnapshot,
        timestamp: now + 100,
    },
    // mutation that adds xlink:href to the use element; an attribute added
    // after the snapshot must be created in the xlink namespace to render
    {
        type: EventType.IncrementalSnapshot,
        data: {
            source: IncrementalSource.Mutation,
            texts: [],
            attributes: [
                {
                    id: 7,
                    attributes: { 'xlink:href': '#icon-b' },
                },
            ],
            removes: [],
            adds: [],
        },
        timestamp: now + 150,
    },
]

export default events
