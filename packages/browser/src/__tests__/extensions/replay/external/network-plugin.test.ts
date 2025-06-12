/// <reference lib="dom" />

import { expect } from '@jest/globals'
import { shouldRecordBody } from '../../../../extensions/replay/external/network-plugin'

// Mock Request class since jsdom might not provide it
class MockRequest {
    url: string
    constructor(url: string) {
        this.url = url
    }
}

// Replace global Request with our mock
global.Request = MockRequest as any

const blobUrlTestCases = [
    { url: 'blob:https://example.com/123', expected: false },
    { url: new URL('blob:https://example.com/123'), expected: false },
    { url: new Request('blob:https://example.com/123'), expected: false },
    { url: 'https://example.com', expected: true },
    { url: new URL('https://example.com'), expected: true },
    { url: new Request('https://example.com'), expected: true },
]

const recordBodyConfigTestCases = [
    { recordBody: false, expected: false },
    { recordBody: true, expected: true },
    { recordBody: { request: true, response: false }, type: 'request', expected: true },
    { recordBody: { request: true, response: false }, type: 'response', expected: false },
    { recordBody: { request: false, response: true }, type: 'request', expected: false },
    { recordBody: { request: false, response: true }, type: 'response', expected: true },
]

const contentTypeTestCases = [
    {
        recordBody: ['application/json'],
        headers: { 'content-type': 'application/json' },
        expected: true,
    },
    {
        recordBody: ['application/json'],
        headers: { 'content-type': 'text/plain' },
        expected: false,
    },
    {
        recordBody: { request: ['application/json'], response: ['text/plain'] },
        type: 'request',
        headers: { 'content-type': 'application/json' },
        expected: true,
    },
    {
        recordBody: { request: ['application/json'], response: ['text/plain'] },
        type: 'response',
        headers: { 'content-type': 'text/plain' },
        expected: true,
    },
]

const edgeCaseTestCases = [
    // Test with null/undefined recordBody
    { recordBody: null, expected: false },
    { recordBody: undefined, expected: false },

    // Test with empty headers
    { recordBody: true, headers: {}, expected: true },

    // Test with case-insensitive content-type header
    {
        recordBody: ['application/json'],
        headers: { 'Content-Type': 'application/json' },
        expected: true,
    },

    // Test with multiple content types in header
    {
        recordBody: ['application/json'],
        headers: { 'content-type': 'application/json; charset=utf-8' },
        expected: true,
    },

    // Test with multiple content types in configuration
    {
        recordBody: ['application/json', 'text/plain'],
        headers: { 'content-type': 'text/plain' },
        expected: true,
    },

    // Test with invalid URL
    { recordBody: true, url: 'not-a-url', expected: true },

    // Test with empty content type in configuration
    {
        recordBody: [],
        headers: { 'content-type': 'application/json' },
        expected: false,
    },
]

const errorHandlingTestCases = [
    // Test with malformed URL
    { recordBody: true, url: 'blob:invalid-url', expected: false },

    // Test with malformed Request object
    { recordBody: true, url: new Request(''), expected: true },

    // Test with malformed URL object
    { recordBody: true, url: new URL('https://example.com'), expected: true },
]

describe('network plugin', () => {
    describe('shouldRecordBody', () => {
        describe('blob URL handling', () => {
            blobUrlTestCases.forEach(({ url, expected }, index) => {
                it(`should ${expected ? 'record' : 'not record'} body for ${typeof url === 'string' ? url : url.constructor.name} (case ${index + 1})`, () => {
                    const result = shouldRecordBody({
                        type: 'request',
                        headers: {},
                        url,
                        recordBody: true,
                    })
                    expect(result).toBe(expected)
                })
            })
        })

        describe('recordBody configuration', () => {
            recordBodyConfigTestCases.forEach(({ recordBody, type = 'request', expected }, index) => {
                it(`should handle ${typeof recordBody === 'object' ? JSON.stringify(recordBody) : recordBody} for ${type} (case ${index + 1})`, () => {
                    const result = shouldRecordBody({
                        type: type as 'request' | 'response',
                        headers: {},
                        url: 'https://example.com',
                        recordBody,
                    })
                    expect(result).toBe(expected)
                })
            })
        })

        describe('content type configuration', () => {
            contentTypeTestCases.forEach(({ recordBody, type = 'request', headers, expected }, index) => {
                it(`should handle ${JSON.stringify(recordBody)} with ${headers['content-type']} for ${type} (case ${index + 1})`, () => {
                    const result = shouldRecordBody({
                        type: type as 'request' | 'response',
                        headers,
                        url: 'https://example.com',
                        recordBody,
                    })
                    expect(result).toBe(expected)
                })
            })
        })

        describe('edge cases', () => {
            edgeCaseTestCases.forEach(({ recordBody, headers = {}, url = 'https://example.com', expected }, index) => {
                it(`should handle edge case ${index + 1}: ${JSON.stringify({ recordBody, headers, url })}`, () => {
                    const result = shouldRecordBody({
                        type: 'request',
                        headers,
                        url,
                        recordBody,
                    })
                    expect(result).toBe(expected)
                })
            })
        })

        describe('error handling', () => {
            errorHandlingTestCases.forEach(({ recordBody, url, expected }, index) => {
                it(`should handle error case ${index + 1}: ${JSON.stringify({ recordBody, url })}`, () => {
                    const result = shouldRecordBody({
                        type: 'request',
                        headers: {},
                        url,
                        recordBody,
                    })
                    expect(result).toBe(expected)
                })
            })
        })
    })
})
