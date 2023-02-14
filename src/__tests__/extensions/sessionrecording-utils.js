import {
    filterDataURLsFromLargeDataObjects,
    replacementImageURI,
    truncateLargeConsoleLogs,
    CONSOLE_LOG_PLUGIN_NAME,
    PLUGIN_EVENT_TYPE,
    FULL_SNAPSHOT_EVENT_TYPE,
} from '../../extensions/sessionrecording-utils'
import { largeString, threeMBAudioURI, threeMBImageURI } from './test_data/sessionrecording-utils-test-data'

describe(`SessionRecording utility functions`, () => {
    describe(`filterLargeDataURLs`, () => {
        it(`should handle null data objects`, () => {
            expect(filterDataURLsFromLargeDataObjects(null)).toBe(null)
        })

        it(`should not touch an object under 5mb`, () => {
            var data = {
                attributes: [
                    {
                        node: {
                            attributes: {
                                src: threeMBImageURI,
                            },
                        },
                    },
                ],
            }
            expect(filterDataURLsFromLargeDataObjects(data)).toEqual(data)
        })

        it(`should replace image data urls if the object is over 5mb`, () => {
            var data = {
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
            }

            expect(filterDataURLsFromLargeDataObjects(data)).toEqual({
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
            })
        })

        it(`should remove non-image data urls if the object is over 5mb`, () => {
            var data = {
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
            }

            expect(filterDataURLsFromLargeDataObjects(data)).toEqual({
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
            })
        })
    })

    describe(`truncateLargeConsoleLogs`, () => {
        it(`should handle null data objects`, () => {
            expect(truncateLargeConsoleLogs(null)).toBe(null)
        })

        it(`should not touch non plugin objects`, () => {
            expect(
                truncateLargeConsoleLogs({
                    type: FULL_SNAPSHOT_EVENT_TYPE, // not plugin
                    data: {
                        plugin: CONSOLE_LOG_PLUGIN_NAME,
                        payload: {
                            payload: largeString,
                        },
                    },
                })
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
                })
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
                })
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
                })
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
                })
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
