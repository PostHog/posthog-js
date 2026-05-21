import { captureException } from '../extensions/exceptions'

const makeError = (stack: string): Error => {
  const err = new Error('Test')
  err.stack = stack
  return err
}

describe('captureException', () => {
  describe('error type + message', () => {
    it.each([
      ['Error', new Error('plain'), 'Error', 'plain'],
      ['TypeError', new TypeError('type'), 'TypeError', 'type'],
      ['ReferenceError', new ReferenceError('ref'), 'ReferenceError', 'ref'],
    ])('captures %s correctly', (_, error, expectedType, expectedMessage) => {
      const result = captureException(error)
      expect(result.type).toBe(expectedType)
      expect(result.message).toBe(expectedMessage)
      expect(result.platform).toBe('javascript')
    })

    it('reads name from a custom Error subclass', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }
      const result = captureException(new CustomError('custom'))
      expect(result.type).toBe('CustomError')
      expect(result.message).toBe('custom')
    })
  })

  describe('non-Error throwables', () => {
    it.each([
      ['string', 'oops', 'oops'],
      ['number', 42, '42'],
      ['boolean', false, 'false'],
      ['null', null, 'null'],
      ['undefined', undefined, 'undefined'],
      ['plain object', { code: 404, message: 'nf' }, JSON.stringify({ code: 404, message: 'nf' })],
    ])('coerces %s into a message string', (_, input, expected) => {
      const result = captureException(input)
      expect(result.message).toBe(expected)
      expect(result.type).toBeUndefined()
      expect(result.stack).toBeUndefined()
      expect(result.frames).toBeUndefined()
      expect(result.platform).toBe('javascript')
    })

    it('does not throw on objects with circular references', () => {
      const obj: any = { name: 'test' }
      obj.self = obj
      const result = captureException(obj)
      expect(typeof result.message).toBe('string')
    })
  })

  describe('stack trace parsing', () => {
    it('parses frames from a real thrown Error', () => {
      const result = captureException(new Error('Test'))
      const frame = result.frames?.[0]
      expect(frame).toMatchObject({
        function: expect.any(String),
        filename: expect.any(String),
        in_app: expect.any(Boolean),
      })
      expect(result.frames!.some((f) => f.in_app)).toBe(true)
    })

    it('parses line + column numbers and named functions', () => {
      const result = captureException(
        makeError(`Error: Test
    at testFunction (/app/src/file.ts:42:15)`)
      )
      expect(result.frames![0]).toMatchObject({
        function: 'testFunction',
        lineno: 42,
        colno: 15,
        in_app: true,
      })
    })

    it.each([
      ['anonymous (no function name)', `Error: Test\n    at /app/src/file.ts:10:5`, '<anonymous>'],
      ['async function', `Error: Test\n    at async asyncFn (/app/src/file.ts:20:10)`, 'async asyncFn'],
      ['native code', `Error: Test\n    at Array.map (native)`, 'Array.map'],
    ])('handles %s', (_, stack, expectedFunction) => {
      const result = captureException(makeError(stack))
      expect(result.frames![0].function).toBe(expectedFunction)
    })

    it('marks node_modules + node: frames as in_app=false, user code as in_app=true', () => {
      const result = captureException(
        makeError(`Error: Test
    at userFn (/app/src/test.ts:10:5)
    at libFn (/app/node_modules/some-lib/index.js:42:10)
    at internal (node:internal/process:123:45)`)
      )
      expect(result.frames!.map((f) => f.in_app)).toEqual([true, false, false])
    })

    it('caps frames at 50 even with a 100-line stack', () => {
      const stack = [
        'Error: Test',
        ...Array.from({ length: 100 }, (_, i) => `    at fn${i} (/app/src/f.ts:${i}:5)`),
      ].join('\n')
      const result = captureException(makeError(stack))
      expect(result.frames!.length).toBeLessThanOrEqual(50)
    })

    it('attaches context_line from the source file for in_app frames only', () => {
      const result = captureException(new Error('test'))
      const inApp = result.frames!.filter((f) => f.in_app)
      expect(inApp.some((f) => f.context_line !== undefined)).toBe(true)
    })

    it('leaves context_line undefined when the source file cannot be read', () => {
      const result = captureException(
        makeError(`Error: Test
    at fn (/nonexistent/path.ts:10:5)`)
      )
      expect(result.frames![0].context_line).toBeUndefined()
    })
  })

  describe('Error.cause chain', () => {
    it('unwraps a single cause', () => {
      const result = captureException(new Error('top', { cause: new Error('root') }))
      expect(result.chained_errors).toHaveLength(1)
      expect(result.chained_errors![0]).toMatchObject({ message: 'root', type: 'Error' })
    })

    it('unwraps a multi-level chain in order', () => {
      const cause = new Error('root')
      const middle = new Error('middle', { cause })
      const top = new Error('top', { cause: middle })
      const result = captureException(top)
      expect(result.chained_errors!.map((e) => e.message)).toEqual(['middle', 'root'])
    })

    it('caps chain depth at 10', () => {
      let err: Error = new Error('Root')
      for (let i = 0; i < 20; i++) err = new Error(`L${i}`, { cause: err })
      const result = captureException(err)
      expect(result.chained_errors!.length).toBeLessThanOrEqual(10)
    })

    it('handles a non-Error cause by stringifying it', () => {
      const result = captureException(new Error('top', { cause: 'string cause' }))
      expect(result.chained_errors).toHaveLength(1)
      expect(result.chained_errors![0].message).toBe('string cause')
      expect(result.chained_errors![0].type).toBeUndefined()
    })

    it('stops on a circular cause reference instead of looping forever', () => {
      const e1 = new Error('one')
      const e2 = new Error('two', { cause: e1 })
      ;(e1 as any).cause = e2
      const result = captureException(e2)
      expect(result.chained_errors!.length).toBeLessThanOrEqual(2)
    })

    it('parses the stack of each cause', () => {
      const result = captureException(new Error('top', { cause: new Error('root') }))
      expect(result.chained_errors![0].stack).toBeDefined()
      expect(result.chained_errors![0].frames).toBeDefined()
    })
  })

  describe('malformed input', () => {
    it('omits stack/frames when Error.stack is undefined', () => {
      const e = new Error('no stack')
      e.stack = undefined
      const result = captureException(e)
      expect(result.stack).toBeUndefined()
      expect(result.frames).toBeUndefined()
    })

    it('keeps the empty message when Error.message has been overwritten to ""', () => {
      const e = new Error('placeholder')
      Object.defineProperty(e, 'message', { value: '' })
      expect(captureException(e).message).toBe('')
    })

    it('returns an empty frames array for whitespace-only stacks', () => {
      expect(captureException(makeError('   \n  ')).frames).toEqual([])
    })

    it('parses what it can from malformed stack lines without throwing', () => {
      const result = captureException(
        makeError(`Error: Test
    at incomplete line
    at /file:10:5
    at fnWithoutParens /file:20:5`)
      )
      expect(result.frames).toBeDefined()
    })
  })

  /**
   * Path normalization is one parametrized table covering the matrix of:
   * - OS conventions (macOS / Linux / Windows user homes)
   * - Common deployment locations (Docker, Heroku, AWS Lambda, /var/www, /opt, /srv)
   * - Project markers (/src/, /lib/, /dist/)
   * - Node.js internals + node_modules normalization
   * - ESM file:// URLs
   * - Edge cases (relative paths, native, paths without any marker)
   *
   * The contract: `filename` is the normalized short form, `abs_path` keeps the original.
   */
  describe('path normalization', () => {
    it.each([
      // [label, raw path from V8 stack, expected filename, expected in_app]
      ['macOS user home', '/Users/john/project/src/index.ts', 'src/index.ts', true],
      ['Linux user home', '/home/ubuntu/app/src/server.ts', 'src/server.ts', true],
      ['Windows user home', 'C:\\Users\\Jane\\projects\\myapp\\src\\index.ts', 'src/index.ts', true],

      [
        'node_modules in user path',
        '/Users/john/project/node_modules/express/lib/router.js',
        'node_modules/express/lib/router.js',
        false,
      ],
      [
        'node_modules scoped package',
        '/app/node_modules/@scope/pkg/dist/index.js',
        'node_modules/@scope/pkg/dist/index.js',
        false,
      ],
      [
        'nested node_modules picks the last one',
        '/app/node_modules/a/node_modules/b/index.js',
        'node_modules/b/index.js',
        false,
      ],
      [
        'Windows-style node_modules',
        'C:\\projects\\app\\node_modules\\lodash\\index.js',
        'node_modules/lodash/index.js',
        false,
      ],

      ['/var/www/ deployment', '/var/www/myapp/src/api/users.ts', 'src/api/users.ts', true],
      ['Docker/Heroku /app/', '/app/dist/server.js', 'dist/server.js', true],
      ['AWS Lambda /var/task/', '/var/task/src/handler.ts', 'src/handler.ts', true],
      ['/usr/src/app/', '/usr/src/app/src/index.ts', 'src/index.ts', true],
      ['/opt/<service>/', '/opt/myservice/lib/main.ts', 'lib/main.ts', true],
      ['/srv/<service>/', '/srv/webapp/src/routes.ts', 'src/routes.ts', true],

      ['/src/ project marker', '/some/long/path/project/src/components/Button.tsx', 'src/components/Button.tsx', true],
      ['/lib/ project marker', '/random/path/myproject/lib/utils/helper.ts', 'lib/utils/helper.ts', true],
      ['/dist/ project marker', '/deployment/path/dist/server.js', 'dist/server.js', true],

      ['node:internal/* collapses', 'node:internal/modules/cjs/loader', 'node:internal', false],
      ['node:fs/promises collapses', 'node:fs/promises', 'node:fs', false],
      ['node:process passes through', 'node:process', 'node:process', false],

      ['file:// URL (POSIX)', 'file:///Users/john/project/src/index.ts', 'src/index.ts', true],
      ['file:// URL (Windows)', 'file:///C:/Users/Jane/project/src/index.ts', 'src/index.ts', true],
      [
        'file:// URL in node_modules',
        'file:///Users/john/project/node_modules/express/lib/router.js',
        'node_modules/express/lib/router.js',
        false,
      ],

      ['already-relative path', 'src/index.ts', 'src/index.ts', true],
      ['native sentinel', 'native', 'native', false],
      ['short path /index.ts', '/index.ts', 'index.ts', true],
      ['unknown path without markers', '/random/path/file.ts', 'random/path/file.ts', true],
    ])('normalizes %s', (_, rawPath, expectedFilename, expectedInApp) => {
      const result = captureException(
        makeError(`Error: Test
    at fn (${rawPath}:10:5)`)
      )
      expect(result.frames![0].filename).toBe(expectedFilename)
      expect(result.frames![0].in_app).toBe(expectedInApp)
    })

    it('preserves the original path in abs_path', () => {
      const result = captureException(
        makeError(`Error: Test
    at fn (/Users/john/long/path/to/project/src/index.ts:10:5)`)
      )
      expect(result.frames![0].filename).toBe('src/index.ts')
      expect(result.frames![0].abs_path).toBe('/Users/john/long/path/to/project/src/index.ts')
    })

    it('normalizes Windows backslashes to forward slashes in filename', () => {
      const result = captureException(
        makeError(`Error: Test
    at fn (C:\\projects\\myapp\\src\\utils\\helper.ts:25:10)`)
      )
      expect(result.frames![0].filename).not.toContain('\\')
    })

    it('handles a mixed user + library + internal stack', () => {
      const result = captureException(
        makeError(`Error: Test
    at userHandler (/Users/dev/project/src/api/handler.ts:50:10)
    at expressMw (/Users/dev/project/node_modules/express/lib/router.js:100:5)
    at Module._compile (node:internal/modules/cjs/loader:1105:14)`)
      )
      expect(result.frames!.map((f) => [f.filename, f.in_app])).toEqual([
        ['src/api/handler.ts', true],
        ['node_modules/express/lib/router.js', false],
        ['node:internal', false],
      ])
    })
  })
})
