import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { createModulerModifier } from '@/extensions/error-tracking/modifiers/module.node'
import { addSourceContext } from '@/extensions/error-tracking/modifiers/context-lines.node'

describe('error conversion', () => {
  const errorPropertiesBuilder = new CoreErrorTracking.ErrorPropertiesBuilder(
    [
      new CoreErrorTracking.EventCoercer(),
      new CoreErrorTracking.ErrorCoercer(),
      new CoreErrorTracking.ObjectCoercer(),
      new CoreErrorTracking.StringCoercer(),
      new CoreErrorTracking.PrimitiveCoercer(),
    ],
    CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser),
    [createModulerModifier(), addSourceContext]
  )

  async function getExceptionList(error: unknown): Promise<CoreErrorTracking.ErrorProperties['$exception_list']> {
    const syntheticException = new Error('PostHog syntheticException')
    const { $exception_list } = errorPropertiesBuilder.buildFromUnknown(error, {
      syntheticException,
    })
    return await errorPropertiesBuilder.modifyFrames($exception_list)
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
