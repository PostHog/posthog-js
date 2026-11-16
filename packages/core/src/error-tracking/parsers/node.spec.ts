import { nodeStackLineParser } from './node'

describe('nodeStackLineParser', () => {
  it.each([
    ['at async Promise.all (index 3)', 'Promise.all'],
    ['at async Promise.all (index 472)', 'Promise.all'],
    ['at async Promise.any (index 11)', 'Promise.any'],
  ])('canonicalizes the V8 Promise index in %s', (line, functionName) => {
    expect(nodeStackLineParser(line, 'node:javascript')).toEqual({
      filename: 'node:internal/promise',
      module: undefined,
      function: functionName,
      lineno: undefined,
      colno: undefined,
      in_app: false,
      platform: 'node:javascript',
    })
  })

  it.each([
    ['at async (/app/server/api/handler.ts:91:27)', 'async'],
    ['at async (work) (/app/server/api/handler.ts:91:27)', '(work)'],
  ])('parses the function name and filename in %s', (line, functionName) => {
    expect(nodeStackLineParser(line, 'node:javascript')).toEqual({
      filename: '/app/server/api/handler.ts',
      module: undefined,
      function: functionName,
      lineno: 91,
      colno: 27,
      in_app: true,
      platform: 'node:javascript',
    })
  })
})
