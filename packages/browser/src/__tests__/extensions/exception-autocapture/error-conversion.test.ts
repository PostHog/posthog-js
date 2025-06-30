/* eslint-disable compat/compat */

import {
    ErrorProperties,
    errorToProperties,
    unhandledRejectionToProperties,
} from '../../../extensions/exception-autocapture/error-conversion'

import { isNull } from '../../../utils/type-utils'
import { expect } from '@jest/globals'

// ugh, jest
// can't reference PromiseRejectionEvent to construct it 🤷
export type PromiseRejectionEventTypes = 'rejectionhandled' | 'unhandledrejection'

export type PromiseRejectionEventInit = {
    promise: Promise<any>
    reason: any
}

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
    it('should convert a string to an error', () => {
        const expected: ErrorProperties = {
            $exception_level: 'error',
            $exception_list: [
                {
                    type: 'InternalError',
                    value: 'but somehow still a string',
                    mechanism: { synthetic: true, handled: true },
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
                    value: "Non-Error 'exception' captured with keys: foo, string",
                    mechanism: { synthetic: true, handled: true },
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
                    value: "Non-Error 'exception' captured with keys: isTrusted",
                    mechanism: { synthetic: true, handled: true },
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
                    mechanism: { synthetic: true, handled: true },
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

        expect(Object.keys(errorProperties)).toHaveLength(3)
        expect(errorProperties.$exception_list[0].type).toEqual('dom-exception')
        expect(errorProperties.$exception_list[0].value).toEqual('oh no disaster')
        expect(errorProperties.$exception_DOMException_code).toEqual('0')
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

    it('should convert unhandled promise rejection that the browser has messed around with', () => {
        const ce = new CustomEvent('unhandledrejection', {
            detail: {
                promise: {},
                reason: new Error('a wrapped rejection event'),
            },
        })
        const errorProperties: ErrorProperties = unhandledRejectionToProperties([
            ce as unknown as PromiseRejectionEvent,
        ])
        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list[0].type).toEqual('UnhandledRejection')
        expect(errorProperties.$exception_list[0].value).toEqual('a wrapped rejection event')
        expect(errorProperties.$exception_level).toEqual('error')
        // the stack trace changes between runs, so we just check that it's there
        expect(errorProperties.$exception_list).toBeDefined()
        expect(errorProperties.$exception_list[0].stacktrace.frames[0].in_app).toEqual(true)
        expect(errorProperties.$exception_list[0].stacktrace.frames[0].filename).toBeDefined()
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(false)
    })

    it('should convert unhandled promise rejection', () => {
        const pre = new PromiseRejectionEvent('unhandledrejection', {
            promise: Promise.resolve('wat'),
            reason: 'My house is on fire',
        })
        const errorProperties: ErrorProperties = unhandledRejectionToProperties([
            pre as unknown as PromiseRejectionEvent,
        ])
        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list[0].type).toEqual('UnhandledRejection')
        expect(errorProperties.$exception_list[0].value).toEqual(
            'Non-Error promise rejection captured with value: My house is on fire'
        )
        expect(errorProperties.$exception_level).toEqual('error')
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
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
        expect(errorProperties.$exception_list.length).toEqual(1)
        expect(errorProperties.$exception_list[0].type).toEqual('Error')
        expect(errorProperties.$exception_list[0].value).toEqual('my error')
        expect(errorProperties.$exception_level).toEqual('error')
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(true)
    })

    it('should forward synthetic and handled props when using cause', () => {
        const originalError = new Error('my original error')
        const error = new Error('my error', { cause: originalError })
        const metadata = { handled: false, synthetic: false }
        const errorProperties: ErrorProperties = errorToProperties({ error, event: undefined }, metadata)
        expect(Object.keys(errorProperties)).toHaveLength(2)
        expect(errorProperties.$exception_list.length).toEqual(2)
        expect(errorProperties.$exception_list[0].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[0].mechanism.handled).toEqual(false)
        expect(errorProperties.$exception_list[1].mechanism.synthetic).toEqual(false)
        expect(errorProperties.$exception_list[1].mechanism.handled).toEqual(false)
    })
})
