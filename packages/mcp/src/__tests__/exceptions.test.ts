import { captureException } from '../extensions/exceptions'

describe('captureException', () => {
  describe('basic error capture', () => {
    it('should capture Error with message and type', () => {
      const error = new Error('Test error message')
      const result = captureException(error)

      expect(result.message).toBe('Test error message')
      expect(result.type).toBe('Error')
      expect(result.stack).toBeDefined()
      expect(result.frames).toBeDefined()
      expect(result.frames!.length).toBeGreaterThan(0)
    })

    it('should capture TypeError with correct type', () => {
      const error = new TypeError('Type error message')
      const result = captureException(error)

      expect(result.message).toBe('Type error message')
      expect(result.type).toBe('TypeError')
    })

    it('should capture ReferenceError with correct type', () => {
      const error = new ReferenceError('Reference error message')
      const result = captureException(error)

      expect(result.message).toBe('Reference error message')
      expect(result.type).toBe('ReferenceError')
    })

    it('should capture custom error class', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }

      const error = new CustomError('Custom error message')
      const result = captureException(error)

      expect(result.message).toBe('Custom error message')
      expect(result.type).toBe('CustomError')
    })

    it("should always set platform to 'javascript'", () => {
      const error = new Error('Test error')
      const result = captureException(error)

      expect(result.platform).toBe('javascript')
    })

    it("should set platform to 'javascript' for non-Error objects", () => {
      const result = captureException('string error')

      expect(result.platform).toBe('javascript')
    })
  })

  describe('stack trace parsing', () => {
    it('should parse stack frames with function names', () => {
      const error = new Error('Test')
      const result = captureException(error)

      expect(result.frames).toBeDefined()
      expect(result.frames!.length).toBeGreaterThan(0)

      // Check that at least one frame has the expected structure
      const frame = result.frames![0]
      expect(frame).toHaveProperty('filename')
      expect(frame).toHaveProperty('function')
      expect(frame).toHaveProperty('in_app')
      expect(typeof frame.in_app).toBe('boolean')
    })

    it('should detect in_app correctly for user code', () => {
      const error = new Error('Test')
      const result = captureException(error)

      // At least one frame should be marked as in_app (this test file)
      const hasInAppFrame = result.frames!.some((frame) => frame.in_app)
      expect(hasInAppFrame).toBe(true)
    })

    it('should detect library code in node_modules', () => {
      // Create a mock stack trace that includes node_modules
      const error = new Error('Test')
      error.stack = `Error: Test
    at userFunction (/app/src/test.ts:10:5)
    at libFunction (/app/node_modules/some-lib/index.js:42:10)
    at internal (node:internal/process:123:45)`

      const result = captureException(error)

      expect(result.frames).toBeDefined()
      expect(result.frames!.length).toBe(3)

      // First frame should be in_app (user code)
      expect(result.frames![0].in_app).toBe(true)
      expect(result.frames![0].filename).toContain('test.ts')

      // Second frame should NOT be in_app (node_modules)
      expect(result.frames![1].in_app).toBe(false)
      expect(result.frames![1].filename).toContain('node_modules')

      // Third frame should NOT be in_app (node internal)
      expect(result.frames![2].in_app).toBe(false)
      expect(result.frames![2].filename).toContain('node:')
    })

    it('should parse line and column numbers', () => {
      const error = new Error('Test')
      error.stack = `Error: Test
    at testFunction (/app/src/file.ts:42:15)`

      const result = captureException(error)

      expect(result.frames).toBeDefined()
      expect(result.frames![0].lineno).toBe(42)
      expect(result.frames![0].colno).toBe(15)
    })

    it('should handle anonymous functions', () => {
      const error = new Error('Test')
      error.stack = `Error: Test
    at /app/src/file.ts:10:5`

      const result = captureException(error)

      expect(result.frames).toBeDefined()
      expect(result.frames![0].function).toBe('<anonymous>')
      expect(result.frames![0].lineno).toBe(10)
      expect(result.frames![0].colno).toBe(5)
    })

    it('should handle async functions', () => {
      const error = new Error('Test')
      error.stack = `Error: Test
    at async asyncFunction (/app/src/file.ts:20:10)`

      const result = captureException(error)

      expect(result.frames).toBeDefined()
      expect(result.frames![0].function).toBe('async asyncFunction')
    })

    it('should handle native code frames', () => {
      const error = new Error('Test')
      error.stack = `Error: Test
    at Array.map (native)
    at userFunction (/app/src/file.ts:10:5)`

      const result = captureException(error)

      expect(result.frames).toBeDefined()
      expect(result.frames![0].function).toBe('Array.map')
      expect(result.frames![0].filename).toBe('native')
      expect(result.frames![0].in_app).toBe(false)
    })

    it('should limit stack frames to 50', () => {
      // Create an error with a very long stack trace
      const error = new Error('Test')
      const stackLines = ['Error: Test']
      for (let i = 0; i < 100; i++) {
        stackLines.push(`    at function${i} (/app/src/file.ts:${i}:5)`)
      }
      error.stack = stackLines.join('\n')

      const result = captureException(error)

      expect(result.frames).toBeDefined()
      expect(result.frames!.length).toBeLessThanOrEqual(50)
    })

    it('should capture context_line for in_app frames', () => {
      // This test throws a real error, so context_line should be captured
      const error = new Error('Test error')
      const result = captureException(error)

      expect(result.frames).toBeDefined()
      const inAppFrames = result.frames!.filter((frame) => frame.in_app)
      expect(inAppFrames.length).toBeGreaterThan(0)

      // At least one in_app frame should have context_line
      const hasContextLine = inAppFrames.some((frame) => frame.context_line !== undefined)
      expect(hasContextLine).toBe(true)
    })

    it('should NOT capture context_line for library code (in_app: false)', () => {
      // Create a mock stack trace with node_modules
      const error = new Error('Test')
      error.stack = `Error: Test
    at libFunction (/app/node_modules/some-lib/index.js:42:10)
    at internal (node:internal/process:123:45)`

      const result = captureException(error)

      expect(result.frames).toBeDefined()
      // All frames should be library code and should NOT have context_line
      for (const frame of result.frames!) {
        expect(frame.in_app).toBe(false)
        expect(frame.context_line).toBeUndefined()
      }
    })

    it('should handle missing files gracefully when extracting context_line', () => {
      // Create a mock stack trace with a non-existent file
      const error = new Error('Test')
      error.stack = `Error: Test
    at testFunction (/nonexistent/file/path.ts:10:5)`

      const result = captureException(error)

      expect(result.frames).toBeDefined()
      expect(result.frames!.length).toBe(1)
      // Frame should be in_app but context_line should be undefined (file not found)
      expect(result.frames![0].in_app).toBe(true)
      expect(result.frames![0].context_line).toBeUndefined()
    })
  })

  describe('Error.cause chain', () => {
    it('should unwrap single cause', () => {
      const rootCause = new Error('Root cause')
      const error = new Error('Wrapper error', { cause: rootCause })

      const result = captureException(error)

      expect(result.message).toBe('Wrapper error')
      expect(result.chained_errors).toBeDefined()
      expect(result.chained_errors!.length).toBe(1)
      expect(result.chained_errors![0].message).toBe('Root cause')
      expect(result.chained_errors![0].type).toBe('Error')
    })

    it('should unwrap multiple causes', () => {
      const rootCause = new Error('Root cause')
      const middleCause = new Error('Middle cause', { cause: rootCause })
      const error = new Error('Top error', { cause: middleCause })

      const result = captureException(error)

      expect(result.chained_errors).toBeDefined()
      expect(result.chained_errors!.length).toBe(2)
      expect(result.chained_errors![0].message).toBe('Middle cause')
      expect(result.chained_errors![1].message).toBe('Root cause')
    })

    it('should limit cause chain to 10', () => {
      // Create a very long cause chain
      let error: Error = new Error('Root')
      for (let i = 0; i < 20; i++) {
        error = new Error(`Level ${i}`, { cause: error })
      }

      const result = captureException(error)

      expect(result.chained_errors).toBeDefined()
      expect(result.chained_errors!.length).toBeLessThanOrEqual(10)
    })

    it('should handle non-Error causes', () => {
      const error = new Error('Wrapper', { cause: 'string cause' })

      const result = captureException(error)

      expect(result.chained_errors).toBeDefined()
      expect(result.chained_errors!.length).toBe(1)
      expect(result.chained_errors![0].message).toBe('string cause')
      expect(result.chained_errors![0].type).toBeUndefined()
    })

    it('should detect circular cause references', () => {
      const error1 = new Error('Error 1')
      const error2 = new Error('Error 2', { cause: error1 })
      // Create circular reference
      ;(error1 as any).cause = error2

      const result = captureException(error2)

      // Should not crash, should stop at circular reference
      expect(result.chained_errors).toBeDefined()
      expect(result.chained_errors!.length).toBeLessThanOrEqual(2)
    })

    it('should capture stack traces for each cause', () => {
      const rootCause = new Error('Root cause')
      const error = new Error('Wrapper', { cause: rootCause })

      const result = captureException(error)

      expect(result.stack).toBeDefined()
      expect(result.frames).toBeDefined()
      expect(result.chained_errors![0].stack).toBeDefined()
      expect(result.chained_errors![0].frames).toBeDefined()
    })
  })

  describe('non-Error objects', () => {
    it('should handle string errors', () => {
      const result = captureException('string error')

      expect(result.message).toBe('string error')
      expect(result.type).toBeUndefined()
      expect(result.stack).toBeUndefined()
      expect(result.frames).toBeUndefined()
    })

    it('should handle number errors', () => {
      const result = captureException(42)

      expect(result.message).toBe('42')
      expect(result.type).toBeUndefined()
    })

    it('should handle boolean errors', () => {
      const result = captureException(false)

      expect(result.message).toBe('false')
      expect(result.type).toBeUndefined()
    })

    it('should handle null', () => {
      const result = captureException(null)

      expect(result.message).toBe('null')
      expect(result.type).toBeUndefined()
    })

    it('should handle undefined', () => {
      const result = captureException(undefined)

      expect(result.message).toBe('undefined')
      expect(result.type).toBeUndefined()
    })

    it('should handle object errors', () => {
      const result = captureException({ code: 404, message: 'Not found' })

      expect(result.message).toBe('{"code":404,"message":"Not found"}')
      expect(result.type).toBeUndefined()
    })

    it('should handle objects with circular references', () => {
      const obj: any = { name: 'test' }
      obj.self = obj // Circular reference

      const result = captureException(obj)

      expect(result.type).toBeUndefined()
      // Should not throw, should return some string representation
      expect(typeof result.message).toBe('string')
    })
  })

  describe('edge cases', () => {
    it('should handle errors without stack traces', () => {
      const error = new Error('No stack')
      error.stack = undefined

      const result = captureException(error)

      expect(result.message).toBe('No stack')
      expect(result.type).toBe('Error')
      expect(result.stack).toBeUndefined()
      expect(result.frames).toBeUndefined()
    })

    it('should handle errors with empty messages', () => {
      const error = new Error('placeholder')
      Object.defineProperty(error, 'message', { value: '' })

      const result = captureException(error)

      expect(result.message).toBe('')
      expect(result.type).toBe('Error')
    })

    it('should handle errors with only whitespace in stack', () => {
      const error = new Error('Test')
      error.stack = '   \n  \n  '

      const result = captureException(error)

      expect(result.stack).toBe('   \n  \n  ')
      expect(result.frames).toEqual([])
    })

    it('should handle malformed stack traces gracefully', () => {
      const error = new Error('Test')
      error.stack = `Error: Test
    at incomplete line without location
    at /file:10:5
    at functionWithNoParens /file:20:5`

      const result = captureException(error)

      // Should not crash, should parse what it can
      expect(result.frames).toBeDefined()
    })
  })

  describe('path normalization', () => {
    describe('user home directory stripping', () => {
      it('should strip macOS user home directories', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at userFunction (/Users/john/project/src/index.ts:10:5)`

        const result = captureException(error)

        // Should find /src/ boundary and normalize to that
        expect(result.frames![0].filename).toBe('src/index.ts')
        expect(result.frames![0].abs_path).toBe('/Users/john/project/src/index.ts')
      })

      it('should strip Linux user home directories', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at userFunction (/home/ubuntu/app/src/server.ts:20:8)`

        const result = captureException(error)

        // Should find /src/ boundary and normalize to that
        expect(result.frames![0].filename).toBe('src/server.ts')
        expect(result.frames![0].abs_path).toBe('/home/ubuntu/app/src/server.ts')
      })

      it('should strip Windows user home directories', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at userFunction (C:\\Users\\Jane\\projects\\myapp\\src\\index.ts:15:10)`

        const result = captureException(error)

        // Should find /src/ boundary and normalize to that
        expect(result.frames![0].filename).toBe('src/index.ts')
        expect(result.frames![0].abs_path).toBe('C:\\Users\\Jane\\projects\\myapp\\src\\index.ts')
      })
    })

    describe('node_modules normalization', () => {
      it('should normalize node_modules paths consistently', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at libFunction (/Users/john/project/node_modules/express/lib/router.js:42:10)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('node_modules/express/lib/router.js')
        expect(result.frames![0].abs_path).toBe('/Users/john/project/node_modules/express/lib/router.js')
        expect(result.frames![0].in_app).toBe(false)
      })

      it('should handle scoped packages in node_modules', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (/app/node_modules/@scope/package/dist/index.js:15:20)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('node_modules/@scope/package/dist/index.js')
        expect(result.frames![0].abs_path).toBe('/app/node_modules/@scope/package/dist/index.js')
      })

      it('should handle nested node_modules', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at deepFunction (/app/node_modules/pkg1/node_modules/pkg2/index.js:10:5)`

        const result = captureException(error)

        // Should take the last node_modules occurrence
        expect(result.frames![0].filename).toBe('node_modules/pkg2/index.js')
      })

      it('should handle Windows-style node_modules paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at libFunction (C:\\projects\\app\\node_modules\\lodash\\index.js:100:20)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('node_modules/lodash/index.js')
        expect(result.frames![0].abs_path).toBe('C:\\projects\\app\\node_modules\\lodash\\index.js')
      })
    })

    describe('deployment path stripping', () => {
      it('should strip /var/www/ paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (/var/www/myapp/src/api/users.ts:25:12)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('src/api/users.ts')
        expect(result.frames![0].abs_path).toBe('/var/www/myapp/src/api/users.ts')
      })

      it('should strip /app/ paths (Docker, Heroku)', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at processRequest (/app/dist/server.js:50:8)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('dist/server.js')
        expect(result.frames![0].abs_path).toBe('/app/dist/server.js')
      })

      it('should strip AWS Lambda paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at lambdaHandler (/var/task/src/handler.ts:30:15)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('src/handler.ts')
        expect(result.frames![0].abs_path).toBe('/var/task/src/handler.ts')
      })

      it('should strip Docker container paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at containerMain (/usr/src/app/src/index.ts:10:5)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('src/index.ts')
        expect(result.frames![0].abs_path).toBe('/usr/src/app/src/index.ts')
      })

      it('should strip /opt/ paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at appMain (/opt/myservice/lib/main.ts:15:8)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('lib/main.ts')
        expect(result.frames![0].abs_path).toBe('/opt/myservice/lib/main.ts')
      })

      it('should strip /srv/ paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at serviceHandler (/srv/webapp/src/routes.ts:42:20)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('src/routes.ts')
        expect(result.frames![0].abs_path).toBe('/srv/webapp/src/routes.ts')
      })
    })

    describe('project boundary detection', () => {
      it('should find /src/ boundary', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (/some/long/path/to/project/src/components/Button.tsx:20:10)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('src/components/Button.tsx')
      })

      it('should find /lib/ boundary', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at utility (/random/path/myproject/lib/utils/helper.ts:35:5)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('lib/utils/helper.ts')
      })

      it('should find /dist/ boundary', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at compiled (/deployment/path/dist/server.js:100:15)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('dist/server.js')
      })

      it('should use the last occurrence of project markers', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (/Users/john/src/project/src/index.ts:10:5)`

        const result = captureException(error)

        // Should use the last /src/ occurrence
        expect(result.frames![0].filename).toBe('src/index.ts')
      })
    })

    describe('Node.js internal module normalization', () => {
      it('should normalize node:internal/* to node:internal', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at Module._compile (node:internal/modules/cjs/loader:1105:14)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('node:internal')
        expect(result.frames![0].in_app).toBe(false)
      })

      it('should normalize node:fs/promises to node:fs', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at readFile (node:fs/promises:50:10)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('node:fs')
        expect(result.frames![0].in_app).toBe(false)
      })

      it('should preserve simple node: modules', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at processNextTick (node:process:400:5)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('node:process')
        expect(result.frames![0].in_app).toBe(false)
      })
    })

    describe('Windows path handling', () => {
      it('should normalize Windows backslashes to forward slashes', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (C:\\projects\\myapp\\src\\utils\\helper.ts:25:10)`

        const result = captureException(error)

        expect(result.frames![0].filename).not.toContain('\\')
        expect(result.frames![0].filename).toContain('/')
      })

      it('should handle Windows paths with mixed separators', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at mixed (C:\\projects/myapp\\src/index.ts:10:5)`

        const result = captureException(error)

        // Windows paths without Users directory won't match user home pattern
        // But should still find /src/ boundary and normalize separators
        expect(result.frames![0].filename).toBe('src/index.ts')
        expect(result.frames![0].filename).not.toContain('\\')
      })
    })

    describe('complex real-world scenarios', () => {
      it('should handle mix of user code and library code', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at userHandler (/Users/dev/project/src/api/handler.ts:50:10)
    at expressMiddleware (/Users/dev/project/node_modules/express/lib/router.js:100:5)
    at Module._compile (node:internal/modules/cjs/loader:1105:14)`

        const result = captureException(error)

        // User code - should find /src/ boundary and normalize to that
        expect(result.frames![0].filename).toBe('src/api/handler.ts')
        expect(result.frames![0].in_app).toBe(true)

        // Library code - should normalize node_modules
        expect(result.frames![1].filename).toBe('node_modules/express/lib/router.js')
        expect(result.frames![1].in_app).toBe(false)

        // Node internal - should normalize
        expect(result.frames![2].filename).toBe('node:internal')
        expect(result.frames![2].in_app).toBe(false)
      })

      it('should handle Docker deployment with node_modules', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at apiHandler (/app/dist/api/users.ts:30:8)
    at validator (/app/node_modules/validator/lib/index.js:42:15)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('dist/api/users.ts')
        expect(result.frames![1].filename).toBe('node_modules/validator/lib/index.js')
      })

      it('should handle AWS Lambda with layers', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (/var/task/src/lambda/handler.ts:20:5)
    at runtime (/opt/nodejs/node_modules/aws-sdk/lib/service.js:150:10)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('src/lambda/handler.ts')
        expect(result.frames![1].filename).toBe('node_modules/aws-sdk/lib/service.js')
      })
    })

    describe('URL scheme normalization', () => {
      it('should handle file:// URLs from ESM modules', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (file:///Users/john/project/src/index.ts:10:5)`

        const result = captureException(error)

        // Should strip file:// and then normalize the path
        expect(result.frames![0].filename).toBe('src/index.ts')
        expect(result.frames![0].abs_path).toBe('file:///Users/john/project/src/index.ts')
      })

      it('should handle file:// URLs with Windows paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (file:///C:/Users/Jane/project/src/index.ts:15:8)`

        const result = captureException(error)

        // Should strip file:// and then normalize the Windows path
        expect(result.frames![0].filename).toBe('src/index.ts')
        expect(result.frames![0].abs_path).toBe('file:///C:/Users/Jane/project/src/index.ts')
      })

      it('should handle file:// URLs in node_modules', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at libFunction (file:///Users/john/project/node_modules/express/lib/router.js:50:5)`

        const result = captureException(error)

        // Should normalize to node_modules path
        expect(result.frames![0].filename).toBe('node_modules/express/lib/router.js')
        expect(result.frames![0].in_app).toBe(false)
      })
    })

    describe('special cases and edge cases', () => {
      it('should preserve already-relative paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (src/index.ts:10:5)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('src/index.ts')
        expect(result.frames![0].abs_path).toBe('src/index.ts')
      })

      it('should preserve special paths like native', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at Array.map (native)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('native')
        expect(result.frames![0].abs_path).toBe('native')
      })

      it('should handle paths without common markers', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at unknownPath (/random/path/without/markers/file.ts:10:5)`

        const result = captureException(error)

        // Should still strip leading slash, but can't normalize further
        expect(result.frames![0].filename).toBe('random/path/without/markers/file.ts')
      })

      it('should handle very short paths', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at handler (/index.ts:1:1)`

        const result = captureException(error)

        expect(result.frames![0].filename).toBe('index.ts')
      })
    })

    describe('backwards compatibility', () => {
      it('should maintain abs_path field with original path', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at func (/Users/john/long/path/to/project/src/index.ts:10:5)`

        const result = captureException(error)

        // filename should be normalized
        expect(result.frames![0].filename).toBe('src/index.ts')

        // abs_path should be unchanged
        expect(result.frames![0].abs_path).toBe('/Users/john/long/path/to/project/src/index.ts')
      })

      it('should maintain all other frame properties', () => {
        const error = new Error('Test')
        error.stack = `Error: Test
    at myFunction (/app/src/test.ts:42:15)`

        const result = captureException(error)

        const frame = result.frames![0]
        expect(frame.function).toBe('myFunction')
        expect(frame.filename).toBeDefined()
        expect(frame.abs_path).toBeDefined()
        expect(frame.lineno).toBe(42)
        expect(frame.colno).toBe(15)
        expect(frame.in_app).toBeDefined()
        expect(typeof frame.in_app).toBe('boolean')
      })
    })
  })
})
