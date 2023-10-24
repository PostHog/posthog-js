import {
    ensureMaxMessageSize,
    replacementImageURI,
    truncateLargeConsoleLogs,
    CONSOLE_LOG_PLUGIN_NAME,
    PLUGIN_EVENT_TYPE,
    FULL_SNAPSHOT_EVENT_TYPE,
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
})
