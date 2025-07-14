import { Lazy } from '../src/extensions/feature-flags/lazy'

describe('Lazy', () => {
  it('should only call the factory once', async (): Promise<void> => {
    let callCount = 0
    const factory = async (): Promise<string> => {
      callCount++
      return 'value'
    }

    const lazy = new Lazy(factory)
    expect(callCount).toBe(0)

    const value1 = await lazy.getValue()
    expect(value1).toBe('value')
    expect(callCount).toBe(1)

    const value2 = await lazy.getValue()
    expect(value2).toBe('value')
    expect(callCount).toBe(1)
  })

  it('should handle errors in the factory', async (): Promise<void> => {
    const factory = async (): Promise<string> => {
      throw new Error('Factory error')
    }

    const lazy = new Lazy(factory)
    await expect(lazy.getValue()).rejects.toThrow('Factory error')
  })

  it('should handle undefined values', async (): Promise<void> => {
    const factory = async (): Promise<undefined> => {
      return undefined
    }

    const lazy = new Lazy(factory)
    const value = await lazy.getValue()
    expect(value).toBeUndefined()
  })

  it('should handle complex types', async (): Promise<void> => {
    interface ComplexType {
      id: number
      name: string
    }

    const factory = async (): Promise<ComplexType> => {
      return { id: 1, name: 'test' }
    }

    const lazy = new Lazy<ComplexType>(factory)
    const value = await lazy.getValue()
    expect(value).toEqual({ id: 1, name: 'test' })
  })

  it('should handle concurrent calls', async (): Promise<void> => {
    let callCount = 0
    const factory = async (): Promise<string> => {
      callCount++
      return 'value'
    }

    const lazy = new Lazy(factory)
    const [value1, value2] = await Promise.all([lazy.getValue(), lazy.getValue()])

    expect(value1).toBe('value')
    expect(value2).toBe('value')
    expect(callCount).toBe(1)
  })
})
