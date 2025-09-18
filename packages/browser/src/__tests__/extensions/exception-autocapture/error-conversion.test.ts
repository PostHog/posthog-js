/* eslint-disable compat/compat */

import { isNull, ErrorTracking } from '@posthog/core'
import { expect } from '@jest/globals'
import { buildErrorPropertiesBuilder } from '../../../posthog-exceptions'

// ugh, jest
// can't reference PromiseRejectionEvent to construct it 🤷
export type PromiseRejectionEventTypes = 'rejectionhandled' | 'unhandledrejection'

export type PromiseRejectionEventInit = {
    promise: Promise<any>
    reason: any
}

type ErrorProperties = ErrorTracking.ErrorProperties

export class PromiseRejectionEvent extends Event {
    public readonly promise: Promise<any>
    public readonly reason: any

    public constructor(type: PromiseRejectionEventTypes, options: PromiseRejectionEventInit) {
        super(type)

        this.promise = options.promise
        this.reason = options.reason
    }
}

// ugh, jest

describe('Error conversion', () => {
    const errorPropertiesBuilder = buildErrorPropertiesBuilder()

    function errorToProperties(
        { event, error }: { event: unknown; error?: Error },
        hint?: { handled?: boolean; syntheticException?: Error }
    ): ErrorProperties {
        return errorPropertiesBuilder.buildFromUnknown(error ?? event, {
            mechanism: {
                handled: hint?.handled,
            },
            syntheticException: hint?.syntheticException,
        })
    }

    it('should convert a string to an error', () => {
        const expected: ErrorProperties = {
            $exception_level: 'error',
            $exception_list: [
                {
                    type: 'InternalError',
                    value: 'but somehow still a string',
                    mechanism: { synthetic: true, handled: true, type: 'generic' },
                },
            ],
        }
        expect(errorToProperties({ event: 'Uncaught exception: InternalError: but somehow still a string' })).toEqual(
            expected
        )
    })

    it('should convert a plain object to an error', () => {
        const expected: ErrorProperties = {
            $exception_level: 'error',
            $exception_list: [
                {
                    type: 'Error',
                    value: 'Object captured as exception with keys: foo, string',
                    mechanism: { synthetic: true, handled: true, type: 'generic' },
                },
            ],
        }
        expect(errorToProperties({ event: { string: 'candidate', foo: 'bar' } as unknown as Event })).toEqual(expected)
    })

    it('should convert a plain Event to an error', () => {
        const expected: ErrorProperties = {
            $exception_level: 'error',
            $exception_list: [
                {
                    type: 'MouseEvent',
                    value: 'MouseEvent captured as exception with keys: isTrusted',
                    mechanism: { synthetic: true, handled: true, type: 'generic' },
                },
            ],
        }
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
        expect(errorToProperties({ event })).toEqual(expected)
    })

    it('should convert a plain Error to an error', () => {
        const error = new Error('oh no an error has happened')

        const errorProperties = errorToProperties({ event: 'something', error })
        if (isNull(errorProperties)) {
            throw new Error("this mustn't be null")
        }

        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_level).toEqual('error')
        // the stack trace changes between runs, so we just check that it's there
        expect(errorProperties.$exception_list).toBeDefined()
        expect(errorProperties.$exception_list[0].type).toEqual('Error')
        expect(errorProperties.$exception_list[0].value).toEqual('oh no an error has happened')
        expect(errorProperties.$exception_list[0].stacktrace.frames[0].in_app).toEqual(true)
        expect(errorProperties.$exception_list[0].stacktrace.frames[0].filename).toBeDefined()
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(true)
    })

    class FakeDomError {
        constructor(
            public name: string,
            public message: string
        ) {}
        [Symbol.toStringTag] = 'DOMError'
    }

    it('should convert a DOM Error to an error', () => {
        const expected: ErrorProperties = {
            $exception_level: 'error',
            $exception_list: [
                {
                    type: 'DOMError',
                    value: 'click: foo',
                    mechanism: { synthetic: false, handled: true, type: 'generic' },
                },
            ],
        }
        const event = new FakeDomError('click', 'foo')
        expect(errorToProperties({ event: event as unknown as Event })).toEqual(expected)
    })

    it('should convert a DOM Exception to an error', () => {
        const event = new DOMException('oh no disaster', 'dom-exception')
        const errorProperties = errorToProperties({ event: event as unknown as Event })

        if (isNull(errorProperties)) {
            throw new Error("this mustn't be null")
        }

        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list[0].type).toEqual('DOMException')
        expect(errorProperties.$exception_list[0].value).toEqual('dom-exception: oh no disaster')
        // expect(errorProperties.$exception_DOMException_code).toEqual('0')
        expect(errorProperties.$exception_level).toEqual('error')
        // the stack trace changes between runs, so we just check that it's there
        expect(errorProperties.$exception_list).toBeDefined()
        expect(errorProperties.$exception_list[0].stacktrace.frames[0].in_app).toEqual(true)
        expect(errorProperties.$exception_list[0].stacktrace.frames[0].filename).toBeDefined()
    })

    it('should convert an error event to an error', () => {
        const event = new ErrorEvent('oh no an error event', { error: new Error('the real error is hidden inside') })

        const errorProperties = errorToProperties({ event: event as unknown as Event })
        if (isNull(errorProperties)) {
            throw new Error("this mustn't be null")
        }

        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list[0].type).toEqual('Error')
        expect(errorProperties.$exception_list[0].value).toEqual('the real error is hidden inside')
        expect(errorProperties.$exception_level).toEqual('error')
        // the stack trace changes between runs, so we just check that it's there
        expect(errorProperties.$exception_list).toBeDefined()
        expect(errorProperties.$exception_list[0].stacktrace.frames[0].in_app).toEqual(true)
        expect(errorProperties.$exception_list[0].stacktrace.frames[0].filename).toBeDefined()
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(true)
    })

    it('should convert unhandled promise rejection', () => {
        const pre = new PromiseRejectionEvent('unhandledrejection', {
            promise: Promise.resolve('wat'),
            reason: 'My house is on fire',
        })
        const errorProperties: ErrorProperties = errorToProperties(
            { event: pre as unknown as PromiseRejectionEvent },
            { handled: false }
        )
        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list[0].type).toEqual('PromiseRejectionEvent')
        expect(errorProperties.$exception_list[0].value).toEqual(
            'PromiseRejectionEvent captured as exception with keys: isTrusted, promise, reason'
        )
        expect(errorProperties.$exception_level).toEqual('error')
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(true)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(false)
    })

    it('should use cause when it is an error', () => {
        class CustomError extends Error {
            constructor(message: string) {
                super(message)
                this.name = 'CustomError'
            }
        }
        const originalError = new CustomError('my original error')
        const error = new Error('my error', { cause: originalError })
        const errorProperties: ErrorProperties = errorToProperties({ error, event: undefined })
        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list[0].type).toEqual('Error')
        expect(errorProperties.$exception_list[0].value).toEqual('my error')
        expect(errorProperties.$exception_level).toEqual('error')
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(true)
        expect(errorProperties.$exception_list[1].type).toEqual('CustomError')
        expect(errorProperties.$exception_list[1].value).toEqual('my original error')
    })

    it('should not use cause prop when it is a string', () => {
        const originalError = 'original test'
        const error = new Error('my error', { cause: originalError })
        const errorProperties: ErrorProperties = errorToProperties({ error, event: undefined })
        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list.length).toEqual(2)
        expect(errorProperties.$exception_list[0].type).toEqual('Error')
        expect(errorProperties.$exception_list[0].value).toEqual('my error')
        expect(errorProperties.$exception_level).toEqual('error')
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(true)
        expect(errorProperties.$exception_list[1].type).toEqual('Error')
        expect(errorProperties.$exception_list[1].value).toEqual('original test')
    })

    it('should not forward handled prop when using cause', () => {
        const originalError = new Error('my original error')
        const error = new Error('my error', { cause: originalError })
        const metadata = { handled: false, syntheticException: new Error('Synthetic') }
        const errorProperties: ErrorProperties = errorToProperties({ error, event: undefined }, metadata)
        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list.length).toEqual(2)
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(false)
        expect(errorProperties.$exception_list[1].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[1].mechanism.handled).toEqual(true)
    })
})
