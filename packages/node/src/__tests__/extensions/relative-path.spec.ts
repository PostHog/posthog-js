import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { createRelativePathModifier } from '@/extensions/error-tracking/modifiers/relative-path.node'

describe('relative path modifier', () => {
  function makeFrame(overrides: Partial<CoreErrorTracking.StackFrame> = {}): CoreErrorTracking.StackFrame {
    return {
      platform: 'node:javascript',
      filename: '/app/src/index.js',
      function: 'handler',
      lineno: 10,
      colno: 5,
      in_app: true,
      ...overrides,
    }
  }

  it('should convert absolute paths to relative', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [makeFrame({ filename: '/app/src/index.js' })]

    const result = await modifier(frames)

    expect(result[0].filename).toBe('src/index.js')
    expect(result[0].abs_path).toBe('/app/src/index.js')
  })

  it('should handle nested paths', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [makeFrame({ filename: '/app/src/lib/utils/helpers.js' })]

    const result = await modifier(frames)

    expect(result[0].filename).toBe('src/lib/utils/helpers.js')
    expect(result[0].abs_path).toBe('/app/src/lib/utils/helpers.js')
  })

  it('should handle node_modules paths', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [makeFrame({ filename: '/app/node_modules/express/index.js', in_app: false })]

    const result = await modifier(frames)

    expect(result[0].filename).toBe('node_modules/express/index.js')
    expect(result[0].abs_path).toBe('/app/node_modules/express/index.js')
    expect(result[0].in_app).toBe(false)
  })

  it('should skip node: prefixed paths', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [makeFrame({ filename: 'node:_http_common' })]

    const result = await modifier(frames)

    expect(result[0].filename).toBe('node:_http_common')
    expect(result[0].abs_path).toBeUndefined()
  })

  it('should skip data: prefixed paths', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [makeFrame({ filename: 'data:text/javascript,console.log(1)' })]

    const result = await modifier(frames)

    expect(result[0].filename).toBe('data:text/javascript,console.log(1)')
    expect(result[0].abs_path).toBeUndefined()
  })

  it('should skip frames without filename', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [makeFrame({ filename: undefined })]

    const result = await modifier(frames)

    expect(result[0].filename).toBeUndefined()
    expect(result[0].abs_path).toBeUndefined()
  })

  it('should leave already-relative paths unchanged', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [makeFrame({ filename: 'src/index.js' })]

    const result = await modifier(frames)

    expect(result[0].filename).toBe('src/index.js')
    expect(result[0].abs_path).toBeUndefined()
  })

  it('should preserve in_app value', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [
      makeFrame({ filename: '/app/src/index.js', in_app: true }),
      makeFrame({ filename: '/app/node_modules/lib/index.js', in_app: false }),
    ]

    const result = await modifier(frames)

    expect(result[0].in_app).toBe(true)
    expect(result[1].in_app).toBe(false)
  })

  it('should handle paths outside the base path', async () => {
    const modifier = createRelativePathModifier('/app')
    const frames = [makeFrame({ filename: '/other/project/file.js' })]

    const result = await modifier(frames)

    expect(result[0].filename).toBe('../other/project/file.js')
    expect(result[0].abs_path).toBe('/other/project/file.js')
  })
})
