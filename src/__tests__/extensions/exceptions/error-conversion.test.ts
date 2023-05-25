import { toErrorProperties, ErrorProperties } from '../../../extensions/exceptions/error-conversion'

describe('Error conversion', () => {
    it('should convert a string to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'InternalError',
            $exception_message: 'but somehow still a string',
            $exception_is_synthetic: true,
        }
        expect(toErrorProperties(['Uncaught exception: InternalError: but somehow still a string'])).toEqual(expected)
    })

    it('should convert a plain object to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'Error',
            $exception_message: 'Non-Error exception captured with keys: foo, string',
            $exception_is_synthetic: true,
        }
        expect(toErrorProperties([{ string: 'candidate', foo: 'bar' } as unknown as Event])).toEqual(expected)
    })

    it('should convert a plain Event to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'MouseEvent',
            $exception_message: 'Non-Error exception captured with keys: isTrusted',
            $exception_is_synthetic: true,
        }
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
        expect(toErrorProperties([event])).toEqual(expected)
    })

    it('should convert a plain Error to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'Error',
            $exception_message: 'oh no an error has happened',
        }
        const error = new Error('oh no an error has happened')
        expect(toErrorProperties(['something', undefined, undefined, undefined, error])).toEqual(expected)
    })

    class FakeDomError {
        constructor(public name: string, public message: string) {}
        [Symbol.toStringTag] = 'DOMError'
    }

    it('should convert a DOM Error to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'Error',
            $exception_message: 'click: foo',
        }
        const event = new FakeDomError('click', 'foo')
        expect(toErrorProperties([event as unknown as Event])).toEqual(expected)
    })

    it('should convert a DOM Exception to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'dom-exception',
            $exception_message: 'oh no disaster',
            $exception_DOMException_code: '0',
        }
        const event = new DOMException('oh no disaster', 'dom-exception')
        expect(toErrorProperties([event as unknown as Event])).toEqual(expected)
    })

    it('should convert an error event to an error', () => {
        const expected: ErrorProperties = {
            $exception_type: 'Error',
            $exception_message: 'the real error is hidden inside',
        }
        const event = new ErrorEvent('oh no an error event', { error: new Error('the real error is hidden inside') })
        expect(toErrorProperties([event as unknown as Event])).toEqual(expected)
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
        expect(toErrorProperties(['string candidate', 'a source', 12, 200])).toEqual(expected)
    })
})
