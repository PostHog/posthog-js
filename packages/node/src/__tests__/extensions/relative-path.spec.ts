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

  it.each([
    { label: 'converts absolute path to relative', filename: '/app/src/index.js', expected: 'src/index.js' },
    { label: 'handles nested paths', filename: '/app/src/lib/utils/helpers.js', expected: 'src/lib/utils/helpers.js' },
    {
      label: 'handles node_modules paths',
      filename: '/app/node_modules/express/index.js',
      expected: 'node_modules/express/index.js',
    },
    { label: 'skips node: prefixed paths', filename: 'node:_http_common', expected: 'node:_http_common' },
    {
      label: 'skips data: prefixed paths',
      filename: 'data:text/javascript,console.log(1)',
      expected: 'data:text/javascript,console.log(1)',
    },
    { label: 'skips frames without filename', filename: undefined, expected: undefined },
    { label: 'leaves already-relative paths unchanged', filename: 'src/index.js', expected: 'src/index.js' },
    {
      label: 'handles paths outside the base path',
      filename: '/other/project/file.js',
      expected: '../other/project/file.js',
    },
  ])('$label', async ({ filename, expected }) => {
    const modifier = createRelativePathModifier('/app')
    const result = await modifier([makeFrame({ filename })])
    expect(result[0].filename).toBe(expected)
  })

  it('should preserve in_app value', async () => {
    const modifier = createRelativePathModifier('/app')
    const result = await modifier([
      makeFrame({ filename: '/app/src/index.js', in_app: true }),
      makeFrame({ filename: '/app/node_modules/lib/index.js', in_app: false }),
    ])

    expect(result[0].in_app).toBe(true)
    expect(result[1].in_app).toBe(false)
  })
})
