import { filterDataURLsFromLargeDataObjects, replacementImageURI } from '../../extensions/sessionrecording-utils'
import { threeMBAudioURI, threeMBImageURI } from './test_data/sessionrecording-utils-test-data'

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
            expect(filterDataURLsFromLargeDataObjects(data)).toMatchObject(data)
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

            expect(filterDataURLsFromLargeDataObjects(data)).toMatchObject({
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

            expect(filterDataURLsFromLargeDataObjects(data)).toMatchObject({
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
})
