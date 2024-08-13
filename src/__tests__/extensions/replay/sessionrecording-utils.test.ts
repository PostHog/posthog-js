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
    circularReferenceReplacer,
} from '../../../extensions/replay/sessionrecording-utils'
import { largeString, threeMBAudioURI, threeMBImageURI } from '../test_data/sessionrecording-utils-test-data'
import { eventWithTime } from '@rrweb/types'

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
            const buffer = {
                size: 5 * 1024 * 1024,
                data: new Array(100).fill(0),
                sessionId: 'session1',
                windowId: 'window1',
            }

            const result = splitBuffer(buffer)
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

            expect(result.length).toBe(20)
            let partTotal = 0
            let sentArray: any[] = []
            result.forEach((part) => {
                expect(part.size).toBeLessThan(SEVEN_MEGABYTES)
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

            const result = splitBuffer(buffer)

            expect(result).toHaveLength(2)
            expect(result[0].data).toEqual(buffer.data.slice(0, 50))
            expect(result[1].data).toEqual(buffer.data.slice(50))
        })

        it('should not split buffer if it has only one element', () => {
            const buffer = {
                size: 10 * 1024 * 1024,
                data: [0],
                sessionId: 'session1',
                windowId: 'window1',
            }

            const result = splitBuffer(buffer)

            expect(result).toEqual([buffer])
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
