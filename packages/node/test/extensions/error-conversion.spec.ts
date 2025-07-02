import { propertiesFromUnknownInput } from '../../src/extensions/error-tracking/error-conversion'
import { ErrorProperties } from '../../src/extensions/error-tracking/types'
import { createStackParser } from '../../src/extensions/error-tracking/stack-parser'

describe('error conversion', () => {
  async function getExceptionList(error: unknown): Promise<ErrorProperties['$exception_list']> {
    const syntheticException = new Error('PostHog syntheticException')
    const exceptionProperties = await propertiesFromUnknownInput(createStackParser(), [], error, {
      syntheticException,
    })
    return exceptionProperties.$exception_list
  }

  it('should create an exception list from a string', async () => {
    const exceptionList = await getExceptionList('My string error')
    expect(exceptionList.length).toEqual(1)
    expect(exceptionList[0].value).toEqual('My string error')
  })

  it('should use the error key in object', async () => {
    const errorObject = { error: new Error('My special error') }
    const exceptionList = await getExceptionList(errorObject)
    expect(exceptionList.length).toEqual(1)
    expect(exceptionList[0].value).toEqual('My special error')
  })

  it('should create an exception list from an error cause', async () => {
    const originalError = new Error('original error')
    const error = new Error('test error', { cause: originalError })
    const exceptionList = await getExceptionList(error)
    expect(exceptionList.length).toEqual(2)
    expect(exceptionList[0].value).toEqual('test error')
    expect(exceptionList[1].value).toEqual('original error')
  })

  it('should create an exception list from a non error cause', async () => {
    const originalError = { error_code: 'XASKJASK' }
    const error = new Error('test error', { cause: originalError })
    const exceptionList = await getExceptionList(error)
    expect(exceptionList.length).toEqual(2)
    expect(exceptionList[0].value).toEqual('test error')
    expect(exceptionList[1].value).toEqual('Object captured as exception with keys: error_code')
  })
})
