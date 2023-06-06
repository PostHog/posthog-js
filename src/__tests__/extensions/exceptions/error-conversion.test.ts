/* eslint-disable compat/compat */

import {
    errorToProperties,
    ErrorProperties,
    unhandledRejectionToProperties,
} from '../../../extensions/exceptions/error-conversion'

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
            $exception_type: 'InternalError',
            $exception_message: 'but somehow still a string',
            $exception_is_synthetic: true,
        }
        expect(errorToProperties(['Uncaught exception: InternalError: but somehow still a string'])).toEqual(expected)
    })

    it('should convert a plain object to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'Error',
            $exception_message: 'Non-Error exception captured with keys: foo, string',
            $exception_is_synthetic: true,
        }
        expect(errorToProperties([{ string: 'candidate', foo: 'bar' } as unknown as Event])).toEqual(expected)
    })

    it('should convert a plain Event to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'MouseEvent',
            $exception_message: 'Non-Error exception captured with keys: isTrusted',
            $exception_is_synthetic: true,
        }
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
        expect(errorToProperties([event])).toEqual(expected)
    })

    it('should convert a plain Error to an error', () => {
        const error = new Error('oh no an error has happened')

        const errorProperties = errorToProperties(['something', undefined, undefined, undefined, error])
        if (errorProperties === null) {
            throw new Error("this mustn't be null")
        }

        expect(Object.keys(errorProperties)).toHaveLength(3)
        expect(errorProperties.$exception_type).toEqual('Error')
        expect(errorProperties.$exception_message).toEqual('oh no an error has happened')
        // the stack trace changes between runs, so we just check that it's there
        expect(errorProperties.$exception_stack_trace_raw).toBeDefined()
        expect(errorProperties.$exception_stack_trace_raw).toContain('{"filename')
    })

    class FakeDomError {
        constructor(public name: string, public message: string) {}
        [Symbol.toStringTag] = 'DOMError'
    }

    it('should convert a DOM Error to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'DOMError',
            $exception_message: 'click: foo',
        }
        const event = new FakeDomError('click', 'foo')
        expect(errorToProperties([event as unknown as Event])).toEqual(expected)
    })

    it('should convert a DOM Exception to an error', () => {
        const event = new DOMException('oh no disaster', 'dom-exception')
        const errorProperties = errorToProperties([event as unknown as Event])

        if (errorProperties === null) {
            throw new Error("this mustn't be null")
        }

        expect(Object.keys(errorProperties)).toHaveLength(4)
        expect(errorProperties.$exception_type).toEqual('dom-exception')
        expect(errorProperties.$exception_message).toEqual('oh no disaster')
        // the stack trace changes between runs, so we just check that it's there
        expect(errorProperties.$exception_stack_trace_raw).toBeDefined()
        expect(errorProperties.$exception_stack_trace_raw).toContain('{"filename')
    })

    it('should convert an error event to an error', () => {
        const event = new ErrorEvent('oh no an error event', { error: new Error('the real error is hidden inside') })

        const errorProperties = errorToProperties([event as unknown as Event])
        if (errorProperties === null) {
            throw new Error("this mustn't be null")
        }

        expect(Object.keys(errorProperties)).toHaveLength(3)
        expect(errorProperties.$exception_type).toEqual('Error')
        expect(errorProperties.$exception_message).toEqual('the real error is hidden inside')
        // the stack trace changes between runs, so we just check that it's there
        expect(errorProperties.$exception_stack_trace_raw).toBeDefined()
        expect(errorProperties.$exception_stack_trace_raw).toContain('{"filename')
    })

    it('can convert source, lineno, colno', () => {
        const expected: ErrorProperties = {
            $exception_colno: 200,
            $exception_is_synthetic: true,
            $exception_lineno: 12,
            $exception_message: 'string candidate',
            $exception_source: 'a source',
            $exception_type: 'Error',
        }
        expect(errorToProperties(['string candidate', 'a source', 12, 200])).toEqual(expected)
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
        expect(Object.keys(errorProperties)).toHaveLength(4)
        expect(errorProperties.$exception_type).toEqual('UnhandledRejection')
        expect(errorProperties.$exception_message).toEqual('a wrapped rejection event')
        expect(errorProperties.$exception_handled).toEqual(false)
        // the stack trace changes between runs, so we just check that it's there
        expect(errorProperties.$exception_stack_trace_raw).toBeDefined()
        expect(errorProperties.$exception_stack_trace_raw).toContain('{"filename')
    })

    it('should convert unhandled promise rejection', () => {
        const pre = new PromiseRejectionEvent('unhandledrejection', {
            promise: Promise.resolve('wat'),
            reason: 'My house is on fire',
        })
        const errorProperties: ErrorProperties = unhandledRejectionToProperties([
            pre as unknown as PromiseRejectionEvent,
        ])
        expect(Object.keys(errorProperties)).toHaveLength(3)
        expect(errorProperties.$exception_type).toEqual('UnhandledRejection')
        expect(errorProperties.$exception_message).toEqual(
            'Non-Error promise rejection captured with value: My house is on fire'
        )
        expect(errorProperties.$exception_handled).toEqual(false)
    })
})
