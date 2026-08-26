import { createNamedError } from './index'

describe('createNamedError', () => {
  it('sets the name and message', () => {
    const error = createNamedError('AbortError', 'timed out')
    expect(error.name).toBe('AbortError')
    expect(error.message).toBe('timed out')
  })

  it('defines name with the same descriptor a plain assignment would produce', () => {
    const error = createNamedError('AbortError', 'timed out')
    expect(Object.getOwnPropertyDescriptor(error, 'name')).toEqual({
      value: 'AbortError',
      writable: true,
      enumerable: true,
      configurable: true,
    })
  })

  it('preserves the name when Error.prototype.name is non-writable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name')!
    Object.defineProperty(Error.prototype, 'name', { value: 'Error', writable: false, configurable: true })
    try {
      const error = createNamedError('AbortError', 'timed out')
      expect(error.name).toBe('AbortError')
      expect(error.message).toBe('timed out')
    } finally {
      Object.defineProperty(Error.prototype, 'name', descriptor)
    }
  })
})
