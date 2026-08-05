import type { CaptureResult } from '../../types'

const volatilePropertyFields = {
    token: ['string', '<project-token>'],
    distinct_id: ['string', '<generated-distinct-id>'],
    $device_id: ['string', '<generated-device-id>'],
    $session_id: ['string', '<generated-session-id>'],
    $window_id: ['string', '<generated-window-id>'],
    $lib_version: ['string', '<sdk-version>'],
    $initialization_time: ['string', '<initialization-time>'],
    $insert_id: ['string', '<insert-id>'],
    $raw_user_agent: ['string', '<user-agent>'],
    $sdk_debug_extensions_init_time_ms: ['number', '<extension-init-time>'],
    $time: ['number', '<event-time>'],
    $timezone: ['string', '<runtime-timezone>'],
    $timezone_offset: ['number', '<runtime-timezone-offset>'],
} as const

export type VolatileCaptureProperty = keyof typeof volatilePropertyFields

export const standardVolatileCaptureProperties: VolatileCaptureProperty[] = [
    'distinct_id',
    '$device_id',
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
]

export const normalizeCaptureResult = (
    captureResult: CaptureResult,
    propertyFields: VolatileCaptureProperty[] = standardVolatileCaptureProperties
) => {
    expect(captureResult.uuid).toEqual(expect.any(String))
    expect(captureResult.timestamp).toEqual(expect.any(Date))

    const properties = { ...captureResult.properties }
    for (const field of propertyFields) {
        const [expectedType, replacement] = volatilePropertyFields[field]
        expect(typeof properties[field]).toBe(expectedType)
        properties[field] = replacement
    }

    return {
        ...captureResult,
        properties,
        timestamp: '<capture-timestamp>',
        uuid: '<event-uuid>',
    }
}
