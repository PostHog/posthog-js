import { describe, expect, it } from 'vitest'

import { captureFailure } from '../src/capture-summary'
import { defineErrorName } from '../src/named-error'

const withFrozenErrorName = (run: () => void): void => {
    const descriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name') ?? {
        value: 'Error',
        writable: true,
        enumerable: false,
        configurable: true,
    }
    Object.defineProperty(Error.prototype, 'name', { value: 'Error', writable: false, configurable: true })
    try {
        run()
    } finally {
        Object.defineProperty(Error.prototype, 'name', descriptor)
    }
}

describe('defineErrorName', () => {
    it('defines name with the same descriptor a plain assignment would produce', () => {
        const error = new Error('timed out')
        defineErrorName(error, 'AbortError')

        expect(Object.getOwnPropertyDescriptor(error, 'name')).toEqual({
            value: 'AbortError',
            writable: true,
            enumerable: true,
            configurable: true,
        })
    })

    it('sets the name when Error.prototype.name is non-writable', () => {
        withFrozenErrorName(() => {
            const error = new Error('timed out')
            defineErrorName(error, 'AbortError')

            expect(error.name).toBe('AbortError')
        })
    })

    it('keeps captureFailure working when Error.prototype.name is non-writable', () => {
        withFrozenErrorName(() => {
            const summary = captureFailure(new Error('network down'))

            expect(summary.allPersisted).toBe(false)
            expect(summary.error?.name).toBe('PostHogCaptureError')
            expect(summary.error?.message).toBe('network down')
        })
    })
})
