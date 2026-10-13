import { ErrorPropertiesBuilder } from './error-properties-builder'
import { chromeStackLineParser, createStackParser } from './parsers'
import { StackFrame } from './types'

describe('ErrorPropertiesBuilder', () => {
  describe('coerceUnknown', () => {
    const errorPropertiesBuilder = new ErrorPropertiesBuilder(
      [],
      createStackParser('web:javascript', chromeStackLineParser),
      []
    )

    function parseStack(error: Error): StackFrame[] | undefined {
      const ctx = { skipFirstLines: 1 }
      //@ts-expect-error: testing private method
      const exception = errorPropertiesBuilder.parseStacktrace(
        {
          type: 'Error',
          value: 'Whatever',
          stack: error.stack,
          synthetic: false,
        },
        ctx
      )
      return exception.stack
    }

    it('should parse stacktraces', () => {
      const syntheticError = new Error()
      const frames = parseStack(syntheticError)
      expect(frames).toBeDefined()
      // The test runner calls itself once per nested describe block, and the parser keeps one copy
      // of a repeated frame cycle, so those repeats count as a single frame here.
      expect(frames).toHaveLength(13)
    })

    it('does not add undefined chunk IDs to unmapped frames', () => {
      const frames: StackFrame[] = [
        { platform: 'web:javascript', filename: 'app.js' },
        { platform: 'web:javascript', filename: 'native' },
      ]

      //@ts-expect-error: testing private method
      const result = errorPropertiesBuilder.applyChunkIds(frames, { 'app.js': 'app-chunk' })

      expect(result[0]).toMatchObject({ chunk_id: 'app-chunk' })
      expect(result[1]).not.toHaveProperty('chunk_id')
    })
  })
})
