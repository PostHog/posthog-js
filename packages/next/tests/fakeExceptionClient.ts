import type { Mock } from 'vitest'

type CaptureImmediateMessage = { distinctId?: string; properties: { $exception_list: object } }

/**
 * A posthog-node client for the request error tests. A middleware or proxy error is built with the error properties
 * builder and sent with captureImmediate, so that it can be marked unhandled; any other error goes to
 * captureExceptionImmediate. captureImmediate passes its error on to `capture` as captureExceptionImmediate takes it,
 * so that a test checks either path the same way.
 */
export function fakeExceptionClient(capture: Mock): {
    captureExceptionImmediate: Mock
    captureImmediate: Mock
    getErrorPropertiesBuilder: () => object
} {
    const errors = new WeakMap<object, unknown>()
    return {
        captureExceptionImmediate: capture,
        captureImmediate: vi.fn(({ distinctId, properties }: CaptureImmediateMessage) =>
            capture(errors.get(properties.$exception_list), distinctId, properties)
        ),
        getErrorPropertiesBuilder: () => ({
            buildFromUnknown: (error: unknown, hint: { mechanism?: object } = {}) => {
                const exceptionList = [{ type: 'Error', mechanism: { ...hint.mechanism } }]
                errors.set(exceptionList, error)
                return { $exception_list: exceptionList, $exception_level: 'error' }
            },
            modifyFrames: async (exceptionList: object[]) => exceptionList,
        }),
    }
}
