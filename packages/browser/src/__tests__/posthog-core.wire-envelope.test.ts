import type { CaptureResult } from '../types'

jest.mock('@posthog/browser-common/utils/globals', () => {
    const globals = jest.requireActual('@posthog/browser-common/utils/globals')
    const { SNAPSHOT_TEST_USER_AGENT } = jest.requireActual('./helpers/normalize-capture-result')
    return {
        ...globals,
        userAgent: SNAPSHOT_TEST_USER_AGENT,
        fetch: jest.fn(),
    }
})

import { fetch } from '@posthog/browser-common/utils/globals'
import { createPosthogInstance } from './helpers/posthog-instance'

const mockedFetch = fetch as jest.MockedFunction<any>
const fixedTimestamp = new Date('2023-11-14T22:13:20.000Z')

const normalizeWireEvent = (event: CaptureResult, generatedProperties: string[]): CaptureResult => {
    const properties = { ...event.properties }
    const replacements: Record<string, string> = {
        $session_id: '<generated-session-id>',
        $window_id: '<generated-window-id>',
        $lib_version: '<sdk-version>',
        $initialization_time: '<initialization-time>',
        $insert_id: '<insert-id>',
        $raw_user_agent: '<user-agent>',
        $sdk_debug_extensions_init_time_ms: '<extension-init-time>',
        $time: '<event-time>',
        $timezone: '<runtime-timezone>',
        $timezone_offset: '<runtime-timezone-offset>',
    }
    const expectedTypes: Record<string, string> = {
        $session_id: 'string',
        $window_id: 'string',
        $lib_version: 'string',
        $initialization_time: 'string',
        $insert_id: 'string',
        $raw_user_agent: 'string',
        $sdk_debug_extensions_init_time_ms: 'number',
        $time: 'number',
        $timezone: 'string',
        $timezone_offset: 'number',
    }

    for (const property of generatedProperties) {
        expect(typeof properties[property]).toBe(expectedTypes[property])
        properties[property] = replacements[property]
    }

    return { ...event, properties }
}

const parsedFetchBodyForPath = (path: string): any => {
    const call = mockedFetch.mock.calls.find(([url]) => new URL(url).pathname === path)
    expect(call).toBeDefined()
    expect(call![1].headers.get('Content-Type')).toBe('application/json')
    expect(call![1].body).toEqual(expect.any(String))
    return JSON.parse(call![1].body)
}

describe('PostHog final decoded request envelopes', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(fixedTimestamp)
        mockedFetch.mockReset()
        mockedFetch.mockResolvedValue({ status: 200, text: () => Promise.resolve('{}') })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('serializes complete enriched /e/ and configured /s/ JSON bodies', async () => {
        const posthog = await createPosthogInstance('wire-snapshot-token', {
            advanced_disable_feature_flags: true,
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            disable_compression: true,
            persistence: 'memory',
            request_batching: false,
            before_send: (event) => event,
        })
        posthog.persistence!.register({
            distinct_id: 'wire-distinct-id',
            $device_id: 'wire-device-id',
        })
        mockedFetch.mockClear()

        posthog.capture(
            'report exported',
            {
                export_format: 'csv',
                row_count: 42,
                undefined_fixture: undefined,
            },
            { uuid: '018bcfe5-6800-7000-8000-000000000001' }
        )

        const recordingEndpoint = posthog.requestRouter.endpointFor('api', '/s/')
        posthog.capture(
            '$snapshot',
            {
                $snapshot_bytes: 60,
                $snapshot_data: [
                    { type: 3, data: { source: 1, omitted_after_json: undefined } },
                    { type: 3, data: { source: 2 } },
                ],
                $session_id: 'recording-session-id',
                $window_id: 'recording-window-id',
                $lib: 'web',
                $lib_version: 'recorder-version',
                $snapshot_host: 'example.com',
            },
            {
                _url: recordingEndpoint,
                _noTruncate: true,
                _batchKey: 'recordings',
                skip_client_rate_limiting: true,
                uuid: '018bcfe5-6800-7000-8000-000000000002',
            }
        )

        const analyticsEnvelope = parsedFetchBodyForPath('/e/')
        expect(analyticsEnvelope.sent_at).toBe(fixedTimestamp.toISOString())
        expect(analyticsEnvelope.batch).toHaveLength(1)
        expect(analyticsEnvelope.batch[0].properties).not.toHaveProperty('undefined_fixture')
        expect({
            ...analyticsEnvelope,
            batch: [
                normalizeWireEvent(analyticsEnvelope.batch[0], [
                    '$session_id',
                    '$window_id',
                    '$lib_version',
                    '$initialization_time',
                    '$insert_id',
                    '$raw_user_agent',
                    '$sdk_debug_extensions_init_time_ms',
                    '$time',
                    '$timezone',
                    '$timezone_offset',
                ]),
            ],
        }).toMatchSnapshot()

        const recordingBody = parsedFetchBodyForPath('/s/')
        expect(recordingBody.sent_at).toBe(fixedTimestamp.toISOString())
        expect(recordingBody.properties.$snapshot_data[0].data).not.toHaveProperty('omitted_after_json')
        expect({ ...recordingBody, properties: { ...recordingBody.properties } }).toMatchSnapshot()
    })
})
