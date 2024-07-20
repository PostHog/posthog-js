import {
    CONSOLE_LOG_PLUGIN_NAME,
    ensureMaxMessageSize,
    estimateSize,
    FULL_SNAPSHOT_EVENT_TYPE,
    PLUGIN_EVENT_TYPE,
    replacementImageURI,
    SEVEN_MEGABYTES,
    splitBuffer,
    truncateLargeConsoleLogs,
} from '../../../extensions/replay/sessionrecording-utils'
import { largeString, threeMBAudioURI, threeMBImageURI } from '../test_data/sessionrecording-utils-test-data'
import { eventWithTime, incrementalSnapshotEvent, IncrementalSource } from '@rrweb/types'
import { serializedNodeWithId } from 'rrweb-snapshot'
import { SnapshotBuffer } from '../../../extensions/replay/sessionrecording'

const ONE_MEGABYTE = 1024 * 1024
const ONE_MEGABYTE_OF_DATA = 'a'.repeat(1024 * 1024)

describe(`SessionRecording utility functions`, () => {
    describe(`filterLargeDataURLs`, () => {
        it(`should not touch an object under 5mb`, () => {
            const data: eventWithTime = {
                attributes: [
                    {
                        node: {
                            attributes: {
                                src: threeMBImageURI,
                            },
                        },
                    },
                ],
            } as unknown as eventWithTime
            expect(ensureMaxMessageSize(data)).toEqual({
                event: data,
                size: 3548406,
            })
        })

        it(`should replace image data urls if the object is over 5mb`, () => {
            const data = {
                attributes: [
                    {
                        node: {
                            attributes: {
                                src: threeMBImageURI,
                            },
                        },
                    },
                    {
                        node: {
                            attributes: {
                                attributes: {
                                    style: {
                                        background: `url(${threeMBImageURI})`,
                                    },
                                },
                            },
                        },
                    },
                ],
            } as unknown as eventWithTime

            expect(ensureMaxMessageSize(data)).toEqual({
                event: {
                    attributes: [
                        {
                            node: {
                                attributes: {
                                    src: replacementImageURI,
                                },
                            },
                        },
                        {
                            node: {
                                attributes: {
                                    attributes: {
                                        style: {
                                            background: `url(${replacementImageURI})`,
                                        },
                                    },
                                },
                            },
                        },
                    ],
                },
                size: 815,
            })
        })

        it(`should remove non-image data urls if the object is over 5mb`, () => {
            const data = {
                attributes: [
                    {
                        node: {
                            attributes: {
                                src: threeMBAudioURI,
                            },
                        },
                    },
                    {
                        node: {
                            attributes: {
                                src: threeMBAudioURI,
                            },
                        },
                    },
                ],
            } as unknown as eventWithTime

            expect(ensureMaxMessageSize(data)).toEqual({
                event: {
                    attributes: [
                        {
                            node: {
                                attributes: {
                                    src: '',
                                },
                            },
                        },
                        {
                            node: {
                                attributes: {
                                    src: '',
                                },
                            },
                        },
                    ],
                },
                size: 86,
            })
        })
    })

    describe(`truncateLargeConsoleLogs`, () => {
        it(`should handle null data objects`, () => {
            expect(truncateLargeConsoleLogs(null as unknown as eventWithTime)).toBe(null)
        })

        it(`should not touch non plugin objects`, () => {
            expect(
                truncateLargeConsoleLogs({
                    type: FULL_SNAPSHOT_EVENT_TYPE,
                    data: {
                        plugin: CONSOLE_LOG_PLUGIN_NAME,
                        payload: {
                            payload: largeString,
                        },
                    },
                } as unknown as eventWithTime)
            ).toEqual({
                type: FULL_SNAPSHOT_EVENT_TYPE,
                data: {
                    plugin: CONSOLE_LOG_PLUGIN_NAME,
                    payload: {
                        payload: largeString,
                    },
                },
            })
        })

        it(`should not touch objects from a different plugin`, () => {
            expect(
                truncateLargeConsoleLogs({
                    type: PLUGIN_EVENT_TYPE,
                    data: {
                        plugin: 'some other plugin',
                        payload: {
                            payload: largeString,
                        },
                    },
                } as eventWithTime)
            ).toEqual({
                type: PLUGIN_EVENT_TYPE,
                data: {
                    plugin: 'some other plugin',
                    payload: {
                        payload: largeString,
                    },
                },
            })
        })

        it(`should truncate large strings from logs`, () => {
            expect(
                truncateLargeConsoleLogs({
                    type: PLUGIN_EVENT_TYPE,
                    data: {
                        plugin: CONSOLE_LOG_PLUGIN_NAME,
                        payload: {
                            payload: ['a', largeString],
                        },
                    },
                } as eventWithTime)
            ).toEqual({
                type: PLUGIN_EVENT_TYPE,
                data: {
                    plugin: CONSOLE_LOG_PLUGIN_NAME,
                    payload: {
                        payload: ['a', largeString.slice(0, 2000) + '...[truncated]'],
                    },
                },
            })
        })

        it(`should truncate large arrays of strings`, () => {
            expect(
                truncateLargeConsoleLogs({
                    type: PLUGIN_EVENT_TYPE,
                    data: {
                        plugin: CONSOLE_LOG_PLUGIN_NAME,
                        payload: {
                            payload: Array(100).fill('a'),
                        },
                    },
                } as eventWithTime)
            ).toEqual({
                type: PLUGIN_EVENT_TYPE,
                data: {
                    plugin: CONSOLE_LOG_PLUGIN_NAME,
                    payload: {
                        payload: [...Array(10).fill('a'), '...[truncated]'],
                    },
                },
            })
        })

        it(`should handle and not touch null or undefined elements`, () => {
            expect(
                truncateLargeConsoleLogs({
                    type: PLUGIN_EVENT_TYPE,
                    data: {
                        plugin: CONSOLE_LOG_PLUGIN_NAME,
                        payload: {
                            payload: [undefined, null],
                        },
                    },
                } as eventWithTime)
            ).toEqual({
                type: PLUGIN_EVENT_TYPE,
                data: {
                    plugin: CONSOLE_LOG_PLUGIN_NAME,
                    payload: {
                        payload: [undefined, null],
                    },
                },
            })
        })
    })

    describe('splitBuffer', () => {
        describe('when many items in the buffer', () => {
            it('should return the same buffer if size is less than the limit', () => {
                const theData = new Array(100).fill(0)
                const buffer = {
                    size: estimateSize(theData),
                    data: theData,
                    sessionId: 'session1',
                    windowId: 'window1',
                }

                const result = splitBuffer(buffer, estimateSize(theData) + 1)
                expect(result).toEqual([buffer])
            })

            it('should split the buffer into two halves if size is greater than or equal to SEVEN_MEGABYTES', () => {
                const data = new Array(100).fill(0)
                const expectedSize = estimateSize(new Array(50).fill(0))
                const buffer = {
                    size: estimateSize(data),
                    data: data,
                    sessionId: 'session1',
                    windowId: 'window1',
                }

                // size limit just below the size of the buffer
                const result = splitBuffer(buffer, 200)

                expect(result).toHaveLength(2)
                expect(result[0].data).toEqual(buffer.data.slice(0, 50))
                expect(result[0].size).toEqual(expectedSize)
                expect(result[1].data).toEqual(buffer.data.slice(50))
                expect(result[1].size).toEqual(expectedSize)
            })

            it('should recursively split the buffer until each part is smaller than SEVEN_MEGABYTES', () => {
                const largeDataArray = new Array(100).fill('a'.repeat(1024 * 1024))
                const largeDataSize = estimateSize(largeDataArray) // >100mb
                const buffer = {
                    size: largeDataSize,
                    data: largeDataArray,
                    sessionId: 'session1',
                    windowId: 'window1',
                }

                const result = splitBuffer(buffer)

                expect(result.length).toBe(15)
                let partTotal = 0
                let sentArray: any[] = []
                result.forEach((part) => {
                    expect(part.size).toBeLessThan(SEVEN_MEGABYTES * 1.2)
                    sentArray = sentArray.concat(part.data)
                    partTotal += part.size
                })

                // it's a bit bigger because we have extra square brackets and commas when stringified
                expect(partTotal).toBeGreaterThan(largeDataSize)
                // but not much bigger!
                expect(partTotal).toBeLessThan(largeDataSize * 1.001)
                // we sent the same data overall
                expect(JSON.stringify(sentArray)).toEqual(JSON.stringify(largeDataArray))
            })

            it('should handle buffer with size exactly SEVEN_MEGABYTES', () => {
                const buffer = {
                    size: SEVEN_MEGABYTES,
                    data: new Array(100).fill(0),
                    sessionId: 'session1',
                    windowId: 'window1',
                }

                const result = splitBuffer(buffer, 101)

                expect(result).toHaveLength(2)
                expect(result[0].data).toEqual(buffer.data.slice(0, 50))
                expect(result[1].data).toEqual(buffer.data.slice(50))
            })

            it('should not split buffer if it has only one element', () => {
                const buffer: SnapshotBuffer = {
                    size: estimateSize([0]),
                    data: [0 as unknown as eventWithTime],
                    sessionId: 'session1',
                    windowId: 'window1',
                }

                const result = splitBuffer(buffer, estimateSize([0]) - 1)

                expect(result).toEqual([buffer])
            })
        })

        describe('when one item in the buffer', () => {
            it('should ignore full snapshots (for now)', () => {
                const buffer: SnapshotBuffer = {
                    size: 14,
                    data: [{ type: '2' } as unknown as eventWithTime],
                    sessionId: 'session1',
                    windowId: 'window1',
                }

                const result = splitBuffer(buffer, 12)
                expect(result).toEqual([buffer])
            })

            it('should split incremental adds', () => {
                const incrementalSnapshot: eventWithTime = {
                    type: 3,
                    timestamp: 12345,
                    data: {
                        source: IncrementalSource.Mutation,
                        adds: [
                            {
                                parentId: 1,
                                nextId: null,
                                node: ONE_MEGABYTE_OF_DATA as unknown as serializedNodeWithId,
                            },
                            {
                                parentId: 2,
                                nextId: null,
                                node: ONE_MEGABYTE_OF_DATA as unknown as serializedNodeWithId,
                            },
                        ],
                        texts: [],
                        attributes: [],
                        // removes are processed first by the replayer, so we need to be sure we're emitting them first
                        removes: [{ parentId: 1, id: 2 }],
                    },
                }
                const expectedSize = estimateSize([incrementalSnapshot])
                const buffer = {
                    size: expectedSize,
                    data: [incrementalSnapshot],
                    sessionId: 'session1',
                    windowId: 'window1',
                }

                const result = splitBuffer(buffer, ONE_MEGABYTE * 0.9)
                expect(result).toHaveLength(3)
                const expectedSplitRemoves = [
                    {
                        timestamp: 12343,
                        type: 3,
                        data: {
                            // removes are processed first by the replayer, so we need to be sure we're emitting them first
                            removes: [{ parentId: 1, id: 2 }],
                            adds: [],
                            texts: [],
                            attributes: [],
                            source: 0,
                        },
                    } as incrementalSnapshotEvent,
                ]
                expect(result[0]).toEqual({
                    ...buffer,
                    size: estimateSize(expectedSplitRemoves),
                    data: expectedSplitRemoves,
                })
                const expectedSplitAddsOne = [
                    {
                        timestamp: 12344,
                        type: 3,
                        data: {
                            source: 0,
                            texts: [],
                            attributes: [],
                            removes: [],
                            adds: [
                                {
                                    parentId: 1,
                                    nextId: null,
                                    node: ONE_MEGABYTE_OF_DATA as unknown as serializedNodeWithId,
                                },
                            ],
                        },
                    },
                ]
                expect(result[1]).toEqual(
                    // the two adds each only fit one at a time, so they are split in order
                    // TODO if we sort these by timestamp at playback what's going to happen...
                    //  we need to maintain the original order
                    {
                        ...buffer,
                        size: estimateSize(expectedSplitAddsOne),
                        data: expectedSplitAddsOne,
                    }
                )
                const expectedSplitAddsTwo = [
                    {
                        timestamp: 12345,
                        type: 3,
                        data: {
                            source: 0,
                            texts: [],
                            attributes: [],
                            removes: [],
                            adds: [
                                {
                                    parentId: 2,
                                    nextId: null,
                                    node: ONE_MEGABYTE_OF_DATA as unknown as serializedNodeWithId,
                                },
                            ],
                        },
                    },
                ]
                expect(result[2]).toEqual({
                    ...buffer,
                    size: estimateSize(expectedSplitAddsTwo),
                    data: expectedSplitAddsTwo,
                })
            })
        })
    })
})
