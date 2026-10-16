import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const LOADER = resolve(__dirname, '../dist/optional/OptionalReactNativeExceptionsManager.js')

// test:unit depends on build in Turbo. Exercise the emitted loader with Node's actual require
// resolution, outside Vitest's module mocks.
const loadExceptionsManager = (platform: string, moduleSource?: string): unknown => {
  const directory = mkdtempSync(join(tmpdir(), 'posthog-optional-exceptions-manager-'))
  try {
    copyFileSync(LOADER, join(directory, 'loader.cjs'))
    const nativeDirectory = join(directory, 'node_modules/react-native')
    mkdirSync(join(nativeDirectory, 'Libraries/Core'), { recursive: true })
    writeFileSync(join(nativeDirectory, 'index.js'), `exports.Platform = { OS: ${JSON.stringify(platform)} }`)
    if (moduleSource !== undefined) {
      writeFileSync(join(nativeDirectory, 'Libraries/Core/ExceptionsManager.js'), moduleSource)
    }
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          "const m = require('./loader.cjs').OptionalReactNativeExceptionsManager; console.log(JSON.stringify({ handleException: typeof m?.handleException, loaded: global.loaded === true }))",
        ],
        { cwd: directory, encoding: 'utf8' }
      )
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('OptionalReactNativeExceptionsManager built loader', () => {
  it('marks the ExceptionsManager deep import as optional in the emitted Metro dependency graph', () => {
    // Resolve from Metro's real location so pnpm's transitive Babel dependency is available.
    const metroRequire = createRequire(realpathSync(resolve(__dirname, '../node_modules/metro/package.json')))
    const parser = metroRequire('@babel/parser')
    const collectDependencies = metroRequire('./src/ModuleGraph/worker/collectDependencies.js')
    const { dependencies } = collectDependencies(parser.parse(readFileSync(LOADER, 'utf8')), {
      asyncRequireModulePath: 'metro-runtime/src/modules/asyncRequire',
      dynamicRequires: 'reject',
      inlineableCalls: [],
      keepRequireNames: true,
      allowOptionalDependencies: true,
      unstable_allowRequireContext: false,
    })

    expect(dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'react-native/Libraries/Core/ExceptionsManager',
          data: expect.objectContaining({ isOptional: true }),
        }),
      ])
    )
  })

  it.each([
    ['CommonJS exports (RN 0.78 and older)', 'global.loaded = true; module.exports = { handleException() {} }'],
    [
      'an ES default export (RN 0.79 and newer)',
      'global.loaded = true; exports.__esModule = true; exports.default = { handleException() {} }',
    ],
  ])('resolves handleException from %s', (_, source) => {
    expect(loadExceptionsManager('ios', source)).toEqual({ loaded: true, handleException: 'function' })
  })

  it('tolerates a missing module', () => {
    expect(loadExceptionsManager('android')).toEqual({ loaded: false, handleException: 'undefined' })
  })

  it('does not load the module on web', () => {
    expect(loadExceptionsManager('web', 'global.loaded = true; module.exports = { handleException() {} }')).toEqual({
      loaded: false,
      handleException: 'undefined',
    })
  })
})
