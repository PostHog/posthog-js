import {
    ensureMaxMessageSize,
    replacementImageURI,
    truncateLargeConsoleLogs,
    CONSOLE_LOG_PLUGIN_NAME,
    PLUGIN_EVENT_TYPE,
    FULL_SNAPSHOT_EVENT_TYPE,
    splitBuffer,
    SEVEN_MEGABYTES,
    estimateSize,
    estimateJsonSize,
    circularReferenceReplacer,
} from '../../../extensions/replay/external/sessionrecording-utils'
import { largeString, threeMBAudioURI, threeMBImageURI } from '../test_data/sessionrecording-utils-test-data'
import type { eventWithTime } from '../../../extensions/replay/types/rrweb-types'

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
        it('should return the same buffer if size is less than SEVEN_MEGABYTES', () => {
            const perEventSize = (5 * 1024 * 1024) / 100
            const buffer = {
                size: 5 * 1024 * 1024,
                data: new Array(100).fill(0),
                sizes: new Array(100).fill(perEventSize),
                sessionId: 'session1',
                windowId: 'window1',
            }

            const result = splitBuffer(buffer)
            expect(result).toEqual([buffer])
        })

        it('should split the buffer into two halves if size is greater than or equal to SEVEN_MEGABYTES', () => {
            const data = new Array(100).fill(0)
            const perEventSize = estimateSize(0)
            const sizes = new Array(100).fill(perEventSize)
            const totalSize = sizes.reduce((a: number, b: number) => a + b, 0)
            const buffer = {
                size: totalSize,
                data: data,
                sizes: sizes,
                sessionId: 'session1',
                windowId: 'window1',
            }

            // size limit just below the size of the buffer
            const result = splitBuffer(buffer, totalSize - 1)
            const expectedHalfSize = 50 * perEventSize

            expect(result).toHaveLength(2)
            expect(result[0].data).toEqual(buffer.data.slice(0, 50))
            expect(result[0].size).toEqual(expectedHalfSize)
            expect(result[1].data).toEqual(buffer.data.slice(50))
            expect(result[1].size).toEqual(expectedHalfSize)
        })

        it('should recursively split the buffer until each part is smaller than SEVEN_MEGABYTES', () => {
            const largeDataArray = new Array(100).fill('a'.repeat(1024 * 1024))
            const perEventSize = estimateSize('a'.repeat(1024 * 1024))
            const sizes = new Array(100).fill(perEventSize)
            const totalSize = sizes.reduce((a: number, b: number) => a + b, 0)
            const buffer = {
                size: totalSize,
                data: largeDataArray,
                sizes: sizes,
                sessionId: 'session1',
                windowId: 'window1',
            }

            const result = splitBuffer(buffer)

            expect(result.length).toBe(20)
            let partTotal = 0
            let sentArray: any[] = []
            result.forEach((part) => {
                expect(part.size).toBeLessThan(SEVEN_MEGABYTES)
                sentArray = sentArray.concat(part.data)
                partTotal += part.size
            })

            // sum of per-event sizes equals the original total
            expect(partTotal).toEqual(totalSize)
            // we sent the same data overall
            expect(JSON.stringify(sentArray)).toEqual(JSON.stringify(largeDataArray))
        })

        it('should handle buffer with size exactly SEVEN_MEGABYTES', () => {
            const perEventSize = SEVEN_MEGABYTES / 100
            const buffer = {
                size: SEVEN_MEGABYTES,
                data: new Array(100).fill(0),
                sizes: new Array(100).fill(perEventSize),
                sessionId: 'session1',
                windowId: 'window1',
            }

            const result = splitBuffer(buffer)

            expect(result).toHaveLength(2)
            expect(result[0].data).toEqual(buffer.data.slice(0, 50))
            expect(result[1].data).toEqual(buffer.data.slice(50))
        })

        it('should not split buffer if it has only one element', () => {
            const buffer = {
                size: 10 * 1024 * 1024,
                data: [0],
                sizes: [10 * 1024 * 1024],
                sessionId: 'session1',
                windowId: 'window1',
            }

            const result = splitBuffer(buffer)

            expect(result).toEqual([buffer])
        })
    })

    describe('estimateJsonSize', () => {
        it.each([
            ['null', null],
            ['string', 'hello'],
            ['empty string', ''],
            ['number', 42],
            ['negative number', -1],
            ['float', 3.14],
            ['true', true],
            ['false', false],
            ['empty object', {}],
            ['empty array', []],
            ['simple object', { a: 1, b: 'two' }],
            ['nested object', { a: { b: { c: 3 } } }],
            ['object with undefined values', { a: 1, b: undefined, c: 'three' }],
            ['array with elements', [1, 'two', true, null]],
            ['array with undefined', [1, undefined, 3]],
            [
                'compressed-event-like structure',
                {
                    type: 3,
                    timestamp: 1700000000000,
                    cv: '2024-10',
                    data: {
                        source: 0,
                        texts: 'H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==',
                        attributes: 'H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==',
                        removes: 'H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==',
                        adds: 'H4sIAAAAAAAAA0tMTgYAYKMCpQQAAAA=',
                        isAttachIframe: true,
                    },
                },
            ],
        ])('matches JSON.stringify length for %s', (_label, value) => {
            expect(estimateJsonSize(value)).toBe(JSON.stringify(value)?.length ?? 0)
        })
    })

    describe('circularReferenceReplacer', () => {
        it('should handle circular references', () => {
            const obj: any = {}
            obj.obj = obj
            const result = JSON.stringify(obj, circularReferenceReplacer())
            expect(result).toEqual('{"obj":"[Circular]"}')
        })

        it('should handle nested circular references', () => {
            const a: any = {}
            const b: any = {}
            a.b = b
            b.a = a
            const result = JSON.stringify(a, circularReferenceReplacer())
            expect(result).toEqual('{"b":{"a":"[Circular]"}}')
        })
    })
})
