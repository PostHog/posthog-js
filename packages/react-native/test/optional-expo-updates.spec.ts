import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

// test:unit depends on build in Turbo. Exercise the emitted loader with Node's actual require
// resolution, outside this workspace's installed Expo modules and Vitest's module mocks.
const loadOptionalExpoUpdates = (platform: string, moduleSource?: string): unknown => {
  const directory = mkdtempSync(join(tmpdir(), 'posthog-optional-expo-updates-'))
  try {
    copyFileSync(resolve(__dirname, '../dist/optional/OptionalExpoUpdates.js'), join(directory, 'loader.cjs'))
    const nativeDirectory = join(directory, 'node_modules/react-native')
    mkdirSync(nativeDirectory, { recursive: true })
    writeFileSync(join(nativeDirectory, 'index.js'), `exports.Platform = { OS: ${JSON.stringify(platform)} }`)
    if (moduleSource !== undefined) {
      const updatesDirectory = join(directory, 'node_modules/expo-updates')
      mkdirSync(updatesDirectory, { recursive: true })
      writeFileSync(join(updatesDirectory, 'index.js'), moduleSource)
    }
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          "console.log(JSON.stringify({ value: require('./loader.cjs').OptionalExpoUpdates, loaded: global.updatesLoaded === true }))",
        ],
        { cwd: directory, encoding: 'utf8' }
      )
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('OptionalExpoUpdates built loader', () => {
  it('marks expo-updates as optional in the emitted Metro dependency graph', () => {
    // Resolve from Metro's real location so pnpm's transitive Babel dependency is available.
    const metroRequire = createRequire(realpathSync(resolve(__dirname, '../node_modules/metro/package.json')))
    const parser = metroRequire('@babel/parser')
    const collectDependencies = metroRequire('./src/ModuleGraph/worker/collectDependencies.js')
    const source = readFileSync(resolve(__dirname, '../dist/optional/OptionalExpoUpdates.js'), 'utf8')
    const { dependencies } = collectDependencies(parser.parse(source), {
      asyncRequireModulePath: 'metro-runtime/src/modules/asyncRequire',
      dynamicRequires: 'reject',
      inlineableCalls: [],
      keepRequireNames: true,
      allowOptionalDependencies: true,
      unstable_allowRequireContext: false,
    })

    expect(dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'expo-updates', data: expect.objectContaining({ isOptional: true }) }),
      ])
    )
  })

  it.each(['ios', 'android'])('tolerates an actually missing module on %s', (platform) => {
    expect(loadOptionalExpoUpdates(platform)).toEqual({ loaded: false })
  })

  it('loads available public constants', () => {
    expect(
      loadOptionalExpoUpdates(
        'ios',
        "global.updatesLoaded = true; exports.isEnabled = true; exports.updateId = 'ota-id'"
      )
    ).toEqual({
      loaded: true,
      value: { isEnabled: true, updateId: 'ota-id' },
    })
  })

  it('tolerates module initialization failure (e.g. unlinked or Expo Go)', () => {
    expect(loadOptionalExpoUpdates('ios', "global.updatesLoaded = true; throw new Error('unlinked')")).toEqual({
      loaded: true,
    })
  })

  it('accepts older modules with missing APIs', () => {
    expect(loadOptionalExpoUpdates('ios', "global.updatesLoaded = true; exports.updateId = 'old-id'")).toEqual({
      loaded: true,
      value: { updateId: 'old-id' },
    })
  })

  it.each(['web', 'macos', 'windows'])('does not even initialize the optional module on %s', (platform) => {
    expect(loadOptionalExpoUpdates(platform, "global.updatesLoaded = true; throw new Error('unsupported')")).toEqual({
      loaded: false,
    })
  })
})
