import { filterDataURLsFromLargeDataObjects, replacementImageURI } from '../../extensions/sessionrecording-utils'
import { tenMBAudioURI, tenMBImageURI } from './test_data/sessionrecording-utils-test-data'

describe(`SessionRecording utility functions`, () => {
    describe(`filterLargeDataURLs`, () => {
        it(`should handle null data objects`, () => {
            expect(filterDataURLsFromLargeDataObjects(null)).toBe(null)
        })

        it(`should not touch an object under 20mb`, () => {
            var data = {
                attributes: [
                    {
                        node: {
                            attributes: {
                                src: tenMBImageURI,
                            },
                        },
                    },
                ],
            }
            expect(filterDataURLsFromLargeDataObjects(data)).toMatchObject(data)
        })

        it(`should replace image data urls if the object is over 20mb`, () => {
            var data = {
                attributes: [
                    {
                        node: {
                            attributes: {
                                src: tenMBImageURI,
                            },
                        },
                    },
                    {
                        node: {
                            attributes: {
                                attributes: {
                                    style: {
                                        background: `url(${tenMBImageURI})`,
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

        it(`should remove non-image data urls if the object is over 20mb`, () => {
            var data = {
                attributes: [
                    {
                        node: {
                            attributes: {
                                src: tenMBAudioURI,
                            },
                        },
                    },
                    {
                        node: {
                            attributes: {
                                src: tenMBAudioURI,
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
