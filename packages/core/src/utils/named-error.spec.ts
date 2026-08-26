import { createNamedError } from './index'

describe('createNamedError', () => {
  it('sets the name and message', () => {
    const error = createNamedError('AbortError', 'timed out')
    expect(error.name).toBe('AbortError')
    expect(error.message).toBe('timed out')
  })

  it('does not throw when Error.prototype.name is non-writable', () => {
    // Anti-fingerprinting extensions can make `Error.prototype.name` read-only.
    const descriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name')
    Object.defineProperty(Error.prototype, 'name', { value: 'Error', writable: false, configurable: true })
    try {
      const error = createNamedError('AbortError', 'timed out')
      expect(error.name).toBe('Error')
      expect(error.message).toBe('timed out')
    } finally {
      if (descriptor) {
        Object.defineProperty(Error.prototype, 'name', descriptor)
      } else {
        delete (Error.prototype as any).name
      }
    }
  })
})
